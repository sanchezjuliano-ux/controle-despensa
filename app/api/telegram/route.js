import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const token = process.env.TELEGRAM_BOT_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

const bot = new Telegraf(token);
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const genAI = new GoogleGenerativeAI(geminiApiKey);

// CÉREBRO PRINCIPAL: Gemini 3.8 Flash
const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

// ==========================================
// MOTOR TÁTICO CENTRAL (Processa Texto e Áudio)
// ==========================================
async function processarOrdem(ctx, texto) {
  const responsavel = ctx.from.first_name || 'Família';

  try {
    const intentPrompt = `
      Analisa a mensagem do utilizador num contexto de gestão de despensa doméstica.
      Classifica a intenção em uma destas quatro categorias exatas:
      1. "REGISTAR" (se o utilizador comprou, adicionou itens ou repôs stock)
      2. "CONSUMIR" (se o utilizador gastou, consumiu, usou, comeu ou quer dar baixa num item)
      3. "CONSULTAR" (se o utilizador está a perguntar o que tem na despensa ou stock)
      4. "COMPARAR_SUGERIR" (se o utilizador quer relatórios ou alertas de stock)

      Devolve APENAS a palavra da categoria ("REGISTAR", "CONSUMIR", "CONSULTAR" ou "COMPARAR_SUGERIR") e mais nada.
      Mensagem: "${texto}"
    `;
    const intentResult = await model.generateContent(intentPrompt);
    const intencao = intentResult.response.text().trim().toUpperCase();

    // 1. LÓGICA: CONSULTAR INVENTÁRIO
    if (intencao.includes('CONSULTAR')) {
      const { data, error } = await supabase.from('despensa').select('*').order('item', { ascending: true });
      if (error || !data || data.length === 0) {
        return ctx.reply('📦 A despensa está vazia ou não consegui aceder aos dados.');
      }
      let msgResposta = "📦 *Inventário Atual da Despensa:*\n";
      
      data.forEach(item => {
        const precoUn = item.preco_unitario ? Number(item.preco_unitario).toFixed(2) : '0.00';
        let alerta = "";
        if (item.quantidade === 0) alerta = " 🚨 *[ACABOU]*";
        else if (item.quantidade === 1) alerta = " ⚠️ *[ACABANDO]*";

        msgResposta += `- *${item.item}* (x${item.quantidade})${alerta} | R$ ${precoUn}\n`;
      });
      return ctx.replyWithMarkdown(msgResposta);
    }

    // 2. LÓGICA: RELATÓRIOS E ALERTAS
    if (intencao.includes('COMPARAR')) {
      const { data, error } = await supabase.from('despensa').select('*');
      if (error) return ctx.reply('📊 Erro ao puxar dados para análise.');
      
      const criticos = data.filter(i => i.quantidade <= 1);
      let alertaMsg = "🚨 *Relatório de Stock Crítico:*\n\n";
      
      if (criticos.length > 0) {
        criticos.forEach(c => {
          if (c.quantidade === 0) alertaMsg += `❌ *${c.item}* ACABOU! (Na lista de compras)\n`;
          else if (c.quantidade === 1) alertaMsg += `⚠️ *${c.item}* está ACABANDO! (Resta 1)\n`;
        });
      } else {
        alertaMsg += "✅ Todos os itens essenciais estão com stock seguro.\n";
      }
      return ctx.replyWithMarkdown(alertaMsg);
    }

    // 3. LÓGICA: CONSUMIR (DAR BAIXA)
    if (intencao.includes('CONSUMIR')) {
      const promptConsumo = `Analisa este texto de consumo de despensa e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1}]. Se a quantidade não for explicitada, assume 1. Texto: "${texto}"`;
      const result = await model.generateContent(promptConsumo);
      let jsonString = result.response.text().trim();
      if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
      if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);
      
      const itensConsumidos = JSON.parse(jsonString);
      let msgResposta = "📉 *Baixa de Itens Registada:*\n";

      for (const produto of itensConsumidos) {
        const { item, quantidade } = produto;
        const qtdBaixa = quantidade || 1;

        const { data: dbItems, error: searchError } = await supabase
          .from('despensa')
          .select('*')
          .ilike('item', `%${item}%`)
          .order('quantidade', { ascending: false });

        if (searchError || !dbItems || dbItems.length === 0) {
          msgResposta += `❌ Não encontrei *${item}* na despensa.\n`;
          continue;
        }

        const dbItem = dbItems[0];
        let novaQuantidade = dbItem.quantidade - qtdBaixa;
        if (novaQuantidade < 0) novaQuantidade = 0; 

        // Atualiza a despensa
        await supabase.from('despensa').update({ quantidade: novaQuantidade }).eq('id', dbItem.id);

        // Histórico de saída
        await supabase.from('historico_movimentacoes').insert([{ 
          item: dbItem.item, 
          tipo_movimento: 'saida', 
          quantidade: qtdBaixa, 
          preco_unitario: dbItem.preco_unitario || 0, 
          responsavel 
        }]);

        let alerta = "";
        if (novaQuantidade === 0) {
          alerta = " 🚨 *[ZERA - Movido para Lista de Compras]* 🛒";
          await supabase.from('lista_compras').insert([{ item: dbItem.item }]);
        } else if (novaQuantidade === 1) alerta = " ⚠️ *[ACABANDO]*";

        msgResposta += `- ${dbItem.item}: ${dbItem.quantidade} ➔ *${novaQuantidade}* ${alerta}\n`;
      }
      return ctx.replyWithMarkdown(msgResposta);
    }

    // 4. LÓGICA: REGISTAR (ENTRADA COM EXTRAÇÃO DE LOJA E PAGAMENTO)
    if (intencao.includes('REGISTAR')) {
      const promptRegisto = `Analisa este texto de registo de compras e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1, "categoria": "Mercearia", "preco": 10.50, "loja": "Nome do Mercado", "pagamento": "Forma de Pagamento"}]. Se o utilizador não mencionar a loja ou o pagamento, preenche com "Não informado". Texto: "${texto}"`;
      
      const result = await model.generateContent(promptRegisto);
      let jsonString = result.response.text().trim();
      if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
      if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);
      
      const itens = JSON.parse(jsonString);
      let msgResposta = "✅ *Compras Registadas (Voltou ao Inventário):*\n";

      for (const produto of itens) {
        const { item, quantidade, categoria, preco, loja, pagamento } = produto;
        const qtdEntrada = quantidade || 1;
        const precoFinal = preco || 0;
        const precoUnit = precoFinal / qtdEntrada;

        const { data: exist } = await supabase.from('despensa').select('*').ilike('item', `%${item}%`);
        
        if (exist && exist.length > 0) {
          await supabase.from('despensa').update({ 
            quantidade: exist[0].quantidade + qtdEntrada, 
            preco_unitario: precoUnit 
          }).eq('id', exist[0].id);
        } else {
          await supabase.from('despensa').insert([{ 
            item, 
            quantidade: qtdEntrada, 
            categoria: categoria || 'Mercearia', 
            local: 'Armário', 
            preco_unitario: precoUnit 
          }]);
        }

        // Histórico de Entrada Tática
        const { error: insertHistoricoError } = await supabase.from('historico_movimentacoes').insert([{ 
          item, 
          tipo_movimento: 'entrada', 
          quantidade: qtdEntrada, 
          preco_unitario: precoUnit, 
          responsavel,
          loja: loja || 'Não informado',
          metodo_pagamento: pagamento || 'Não informado'
        }]);

        if (insertHistoricoError) console.error("ERRO NO SUPABASE:", insertHistoricoError);
        
        await supabase.from('lista_compras').delete().ilike('item', `%${item}%`);

        msgResposta += `- ${item} (x${qtdEntrada}) | Loja: ${loja || '?'} | R$ ${precoFinal.toFixed(2)}\n`;
      }
      return ctx.replyWithMarkdown(msgResposta);
    }

    return ctx.reply("❌ Ordem ambígua. Especifica se queres Registar (compras), Consumir (dar baixa) ou Consultar o inventário.");

  } catch (error) {
    console.error("ERRO COMPLETO:", error);
    ctx.reply('❌ Erro tático ao processar a ordem na base de dados ou falha na IA.');
  }
}

// ==========================================
// GATILHO 1: MENSAGENS DE TEXTO
// ==========================================
bot.on('text', async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith('/')) return;
  await processarOrdem(ctx, texto);
});

// ==========================================
// GATILHO 2: MENSAGENS DE ÁUDIO (NOVO!)
// ==========================================
bot.on('voice', async (ctx) => {
  try {
    await ctx.reply("🎙️ Áudio recebido. A transcrever a ordem...");

    // 1. Extrair o ficheiro de áudio do servidor do Telegram
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await fetch(fileLink.href);
    const buffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(buffer).toString("base64");

    // 2. Preparar os dados Multimodais para o Gemini
    const audioPart = {
      inlineData: {
        data: base64Audio,
        mimeType: ctx.message.voice.mime_type || "audio/ogg",
      },
    };

    // 3. IA Transcreve o Áudio
    const promptTranscricao = "Transcreve exatamente o que foi dito neste áudio. Devolve APENAS o texto puro, sem aspas, sem asteriscos e sem explicações.";
    const transcricaoResult = await model.generateContent([promptTranscricao, audioPart]);
    const textoTranscrito = transcricaoResult.response.text().trim();

    await ctx.reply(`✅ Transcrição: "${textoTranscrito}"\n⚙️ A executar...`);

    // 4. Atirar a transcrição para o motor central como se fosse texto
    await processarOrdem(ctx, textoTranscrito);

  } catch (error) {
    console.error("Erro no processamento de áudio:", error);
    ctx.reply("❌ Falha ao processar o áudio. Tenta escrever ou grava de novo.");
  }
});

export async function POST(req) {
  try {
    const body = await req.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro no webhook' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Bot online na Vercel 24/7' });
}
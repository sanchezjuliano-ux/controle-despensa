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

// CORREÇÃO: Utilizando o modelo correto gemini-3.8-flash
const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

async function processarOrdem(ctx, texto) {
  const responsavel = ctx.from.first_name || 'Família';

  try {
    const intentPrompt = `
      Analisa a mensagem do utilizador num contexto de gestão de despensa doméstica.
      Classifica a intenção em uma destas cinco categorias exatas:
      1. "REGISTAR" (se o utilizador comprou, adicionou itens ou repôs stock)
      2. "CONSUMIR" (se o utilizador gastou, consumiu, usou, comeu ou quer dar baixa num item)
      3. "CONSULTAR" (se o utilizador está a perguntar o que tem na despensa, stock atual ou o que está num local específico como gaveta, armário, frigorífico)
      4. "COMPARAR_SUGERIR" (se o utilizador quer relatórios gerais de stock crítico ou compras pendentes)
      5. "ANALISE_CONSUMO" (se o utilizador está a perguntar quanto tempo dura um produto específico)

      Devolve APENAS a palavra da categoria ("REGISTAR", "CONSUMIR", "CONSULTAR", "COMPARAR_SUGERIR" ou "ANALISE_CONSUMO") e mais nada.
      Mensagem: "${texto}"
    `;

    let intentResult = await model.generateContent(intentPrompt);
    const intencao = intentResult.response.text().trim().toUpperCase();

    if (intencao.includes('CONSULTAR')) {
      const textoLower = texto.toLowerCase();
      let query = supabase.from('despensa').select('*');

      // Deteta se o utilizador especificou um local na pergunta
      if (textoLower.includes('gaveta')) {
        query = query.ilike('local', '%gaveta%');
      } else if (textoLower.includes('armário') || textoLower.includes('armario')) {
        query = query.ilike('local', '%armário%');
      } else if (textoLower.includes('frigorífico') || textoLower.includes('geladeira')) {
        query = query.ilike('local', '%frigorífico%');
      } else if (textoLower.includes('despensa')) {
        query = query.ilike('local', '%despensa%');
      }

      const { data, error } = await query.order('item', { ascending: true });
      
      if (error || !data || data.length === 0) {
        return ctx.reply('📦 Não encontrei itens registados com esse filtro ou local.');
      }

      let msgResposta = "📦 *Inventário Encontrado:*\n\n";
      data.forEach(item => {
        const precoUn = item.preco_unitario ? Number(item.preco_unitario).toFixed(2) : '0.00';
        let alerta = "";
        if (item.quantidade === 0) alerta = " 🚨 *[ACABOU]*";
        else if (item.quantidade === 1) alerta = " ⚠️ *[ACABANDO]*";
        msgResposta += `• *${item.item}* (x${item.quantidade})${alerta} | Local: ${item.local || 'Armário'}\n`;
      });
      return ctx.replyWithMarkdown(msgResposta);
    }

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

    if (intencao.includes('ANALISE_CONSUMO')) {
      const promptItem = `Extrai apenas o nome do produto ou ingrediente que o utilizador quer saber o tempo de consumo. Devolve só o nome do item. Frase: "${texto}"`;
      const resItem = await model.generateContent(promptItem);
      const nomeItemBusca = resItem.response.text().trim();

      const { data: histData, error: histError } = await supabase
        .from('historico_movimentacoes')
        .select('*')
        .ilike('item', `%${nomeItemBusca}%`)
        .order('created_at', { ascending: true });

      if (histError || !histData || histData.length === 0) {
        return ctx.reply(`🔍 Não encontrei histórico suficiente para o item "${nomeItemBusca}" para calcular o tempo de consumo.`);
      }

      let totalDias = 0;
      let ciclos = 0;
      let ultimaEntrada = null;

      for (const mov of histData) {
        const dataMov = new Date(mov.created_at);
        if (mov.tipo_movimento === 'entrada') {
          ultimaEntrada = dataMov;
        } else if (mov.tipo_movimento === 'saida' && ultimaEntrada) {
          const diffDays = Math.ceil(Math.abs(dataMov.getTime() - ultimaEntrada.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 0) {
            totalDias += diffDays;
            ciclos++;
          }
          ultimaEntrada = null;
        }
      }

      if (ciclos === 0) {
        return ctx.reply(`📊 O item "${nomeItemBusca}" tem registos, mas ainda não completou um ciclo completo de entrada e término no histórico.`);
      }

      const mediaDias = Math.round(totalDias / ciclos);
      return ctx.replyWithMarkdown(`⏳ *Análise de Consumo para "${nomeItemBusca}":*\n\nCom base no teu histórico, este item dura em média *${mediaDias} dias* na despensa até precisar de reposição.`);
    }

    if (intencao.includes('CONSUMIR')) {
      const promptConsumo = `Analisa este texto de consumo de despensa e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1}]. Se a quantidade não for explicitada, assume 1. Texto: "${texto}"`;
      let result;
      try {
        result = await model.generateContent(promptConsumo);
        if (!result || !result.response || !result.response.text()) {
          throw new Error("Resposta vazia ao processar consumo.");
        }
      } catch (aiError) {
        console.error("ERRO IA (Consumo) - TAREFA CANCELADA:", aiError.message);
        return ctx.reply('❌ Tarefa cancelada devido a uma falha no processamento do consumo. Tenta novamente.');
      }

      let jsonString = result.response.text().trim();
      if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
      if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);

      const itensConsumidos = JSON.parse(jsonString);
      let msgResposta = "📉 *Baixa de Itens Registada:*\n\n";

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

        const updatePayload = novaQuantidade === 0 ? { quantidade: 0, validade: null } : { quantidade: novaQuantidade };
        await supabase.from('despensa').update(updatePayload).eq('id', dbItem.id);

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

        msgResposta += `• ${dbItem.item}: ${dbItem.quantidade} ➔ *${novaQuantidade}*${alerta}\n`;
      }
      return ctx.replyWithMarkdown(msgResposta);
    }

    if (intencao.includes('REGISTAR')) {
      const promptRegisto = `Analisa este texto de registo de compras e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1, "categoria": "Mercearia", "preco": 10.50, "loja": "Nome do Mercado", "pagamento": "Forma de Pagamento"}]. Se o utilizador não mencionar a loja ou o pagamento, preenche com "Não informado". Texto: "${texto}"`;
      let result;
      try {
        result = await model.generateContent(promptRegisto);
        if (!result || !result.response || !result.response.text()) {
          throw new Error("Resposta vazia ao processar registo.");
        }
      } catch (aiError) {
        console.error("ERRO IA (Registo) - TAREFA CANCELADA:", aiError.message);
        return ctx.reply('❌ Tarefa cancelada devido a uma falha no processamento do registo. Tenta novamente.');
      }

      let jsonString = result.response.text().trim();
      if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
      if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);

      const itens = JSON.parse(jsonString);
      let msgResposta = "✅ *Compras Registadas (Voltou ao Inventário):*\n\n";

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
        msgResposta += `• ${item} (x${qtdEntrada}) | Loja: ${loja || '?'} | R$ ${precoFinal.toFixed(2)}\n`;
      }
      return ctx.replyWithMarkdown(msgResposta);
    }

    return ctx.reply("❌ Ordem ambígua. Podes mandar em linguagem natural o que compraste, o que gastaste ou perguntar métricas como o tempo de consumo.");

  } catch (error) {
    console.error("ERRO COMPLETO - TAREFA CANCELADA:", error);
    ctx.reply('❌ Tarefa cancelada devido a um erro inesperado no processamento.');
  }
}

bot.on('photo', async (ctx) => {
  try {
    await ctx.reply("📸 Foto recebida. A analisar talão/etiqueta...");
    const fotos = ctx.message.photo;
    const maiorFoto = fotos[fotos.length - 1];
    const legenda = ctx.message.caption || "1";
    
    const fileLink = await ctx.telegram.getFileLink(maiorFoto.file_id);
    const response = await fetch(fileLink.href);
    const buffer = await response.arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg",
      },
    };

    const promptFoto = `Analisa esta imagem de talão ou etiqueta. Extrai os dados e devolve APENAS um JSON válido no formato: [{"item": "Nome do Produto", "quantidade": ${legenda}, "preco": 0.00, "loja": "Nome do Mercado"}]. Se não encontrar o preço, bota 0.`;
    
    const fotoResult = await model.generateContent([promptFoto, imagePart]);
    let jsonString = fotoResult.response.text().trim();
    if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
    if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);

    const itensLidos = JSON.parse(jsonString);
    let msgResposta = "✅ *Itens extraídos da foto e registados:*\n\n";

    for (const produto of itensLidos) {
      const { item, quantidade, preco, loja } = produto;
      const qtdEntrada = quantidade || parseInt(legenda) || 1;
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
          categoria: 'Mercearia', 
          local: 'Armário', 
          preco_unitario: precoUnit 
        }]);
      }

      await supabase.from('historico_movimentacoes').insert([{ 
        item, 
        tipo_movimento: 'entrada', 
        quantidade: qtdEntrada, 
        preco_unitario: precoUnit, 
        responsavel: ctx.from.first_name || 'Família',
        loja: loja || 'Supermercado',
        metodo_pagamento: 'Não informado'
      }]);
      
      await supabase.from('lista_compras').delete().ilike('item', `%${item}%`);
      msgResposta += `• ${item} (x${qtdEntrada}) | R$ ${precoFinal.toFixed(2)}\n`;
    }

    await ctx.replyWithMarkdown(msgResposta);
  } catch (error) {
    console.error("Erro na foto:", error);
    ctx.reply("❌ Erro ao processar a fotografia do talão. Tenta enviar uma foto mais nítida.");
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
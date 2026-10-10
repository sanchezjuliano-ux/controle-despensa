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
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

bot.on('text', async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith('/')) return;
  
  const responsavel = ctx.from.first_name || 'Família';

  try {
    const intentPrompt = `
      Analisa a mensagem do utilizador num contexto de gestão de despensa doméstica.
      Classifica a intenção em uma destas três categorias exatas:
      1. "REGISTAR" (se o utilizador comprou ou quer adicionar itens/compras)
      2. "CONSULTAR" (se o utilizador está a perguntar o que tem na despensa, stock ou inventário)
      3. "COMPARAR_SUGERIR" (se o utilizador quer comparar preços, ver histórico ou pedir sugestões/alertas de stock crítico)

      Devolve APENAS a palavra da categoria ("REGISTAR", "CONSULTAR" ou "COMPARAR_SUGERIR") e mais nada.
      Mensagem: "${texto}"
    `;
    const intentResult = await model.generateContent(intentPrompt);
    const intencao = intentResult.response.text().trim().toUpperCase();

    if (intencao.includes('CONSULTAR')) {
      const { data, error } = await supabase.from('despensa').select('*');
      if (error || !data || data.length === 0) {
        return ctx.reply('📦 A despensa está vazia ou não consegui aceder aos dados.');
      }
      let msgResposta = "📦 *Inventário Atual da Despensa (Alerta de Stock Ativo):*\n";
      data.forEach(item => {
        const precoUn = item.preco_unitario ? Number(item.preco_unitario).toFixed(2) : '0.00';
        const alerta = item.quantidade <= 1 ? " ⚠️ *[CRÍTICO]*" : "";
        msgResposta += `- *${item.item}* (x${item.quantidade})${alerta} | R$ ${precoUn}\n`;
      });
      return ctx.replyWithMarkdown(msgResposta);
    }

    if (intencao.includes('COMPARAR')) {
      const { data, error } = await supabase.from('despensa').select('*');
      if (error || !data) {
        return ctx.reply('📊 Sem dados suficientes para análise.');
      }
      const criticos = data.filter(i => i.quantidade <= 1);
      let alertaMsg = "🚨 *Relatório de Stock Crítico / Sugestões:*\n";
      if (criticos.length > 0) {
        criticos.forEach(c => {
          alertaMsg += `- O item *${c.item}* está a acabar (restam ${c.quantidade}). Repor com urgência!\n`;
        });
      } else {
        alertaMsg += "Todos os itens essenciais estão com stock seguro acima de 1 unidade.\n";
      }
      return ctx.replyWithMarkdown(alertaMsg);
    }

    const promptRegisto = `Analisa este texto de registo de despensa e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1, "categoria": "Mercearia", "preco": 10.50}]. Texto: "${texto}"`;
    const result = await model.generateContent(promptRegisto);
    let jsonString = result.response.text().trim();
    if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
    if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);
    
    const itens = JSON.parse(jsonString);
    let msgResposta = "✅ *Itens Registados na Nuvem:*\n";

    for (const produto of itens) {
      const { item, quantidade, categoria, preco } = produto;
      const precoFinal = preco || 0;
      const precoUnit = precoFinal / (quantidade || 1);

      await supabase.from('despensa').insert([{ item, quantidade: quantidade || 1, categoria: categoria || 'Mercearia', local: 'Armário', preco_unitario: precoUnit }]);
      await supabase.from('historico_movimentacoes').insert([{ item, tipo_movimento: 'entrada', quantidade: quantidade || 1, preco_unitario: precoUnit, responsavel }]);
      
      msgResposta += `- ${item} (x${quantidade || 1}) | R$ ${precoFinal.toFixed(2)}\n`;
    }
    ctx.replyWithMarkdown(msgResposta);
  } catch (error) {
    console.error(error);
    ctx.reply('❌ Erro tático ao processar a ordem.');
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
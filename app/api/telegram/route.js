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

// ==========================================
// O RECUO TÁTICO: Motor gemini-1.0-pro para furar o bloqueio 404 da Google
// ==========================================
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

bot.on('text', async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith('/')) return;
  
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

    // ==========================================
    // 1. LÓGICA: CONSULTAR INVENTÁRIO
    // ==========================================
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

    // ==========================================
    // 2. LÓGICA: RELATÓRIOS E ALERTAS
    // ==========================================
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

    // ==========================================
    // 3. LÓGICA: CONSUMIR (DAR BAIXA) -> VAI PARA LISTA DE COMPRAS
    // ==========================================
    if (intencao.includes('CONSUMIR')) {
      const promptConsumo = `Analisa este texto de consumo de despensa e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1}]. Se a quantidade não for explicitada, assume 1. Texto: "${texto}"`;
      const result = await model.generateContent(promptConsumo);
      let jsonString = result.response.text().trim();
      if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
      if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);
      
      const itensConsumidos =
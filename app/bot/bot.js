const { Telegraf } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const axios = require('axios')
require('dotenv').config({ path: '.env.local' })

const token = process.env.TELEGRAM_BOT_TOKEN
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const geminiApiKey = process.env.GEMINI_API_KEY

if (!token || !geminiApiKey) {
  console.error('❌ TELEGRAM_BOT_TOKEN ou GEMINI_API_KEY em falta no .env.local')
  process.exit(1)
}

const bot = new Telegraf(token)
const supabase = createClient(supabaseUrl, supabaseAnonKey)
const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" })

bot.start((ctx) => {
  ctx.reply('📦 Olá! O Bot da Despensa Familiar está pronto para ajudar.\n\nPodes enviar texto natural, tirar FOTO a um talão, ou mandar um ÁUDIO com os produtos comprados.')
})

// === 1. MÓDULO DE TEXTO ===
bot.on('text', async (ctx) => {
  const texto = ctx.message.text
  
  if (texto.startsWith('/')) return;
  
  ctx.reply('🧠 A pensar... a organizar os itens.')
  const responsavel = ctx.from.first_name || 'Família'

  try {
    const prompt = `
      Analisa este texto de registo de despensa. 
      Extrai os itens e devolve APENAS um array JSON válido.
      Formato exigido: [{"item": "Nome do Produto", "quantidade": 1, "categoria": "Genérica", "preco": 10.50}]
      Se o preço não for mencionado, mete 0. Infere a categoria. Devolve SÓ o JSON sem markdown.
      Texto do utilizador: "${texto}"
    `
    
    const result = await model.generateContent(prompt)
    
    let jsonString = result.response.text().trim()
    if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3)
    if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3)
    
    const itens = JSON.parse(jsonString)
    let inseridos = 0
    let msgResposta = "✅ *Itens Registados:*\n"

    for (const produto of itens) {
      const { item, quantidade, categoria, preco } = produto
      const precoFinal = preco || 0
      const precoUnit = precoFinal / (quantidade || 1)

      await supabase.from('despensa').insert([{ item, quantidade: quantidade || 1, categoria: categoria || 'Mercearia', local: 'Armário', preco_unitario: precoUnit }])
      await supabase.from('historico_movimentacoes').insert([{ item, tipo_movimento: 'entrada', quantidade: quantidade || 1, preco_unitario: precoUnit, responsavel }])
      
      inseridos++
      msgResposta += `- ${item} (x${quantidade || 1}) | R$ ${precoFinal.toFixed(2)}\n`
    }
    ctx.replyWithMarkdown(msgResposta + `\nTotal registado: ${inseridos} itens. Já está no Dashboard!`)
  } catch (error) {
    console.error(error)
    ctx.reply('❌ Puxa, não consegui entender bem a mensagem. Podes tentar escrever de forma um pouco mais simples, por favor?')
  }
})

// === 2. MÓDULO DE VISÃO (FOTOS) ===
bot.on('photo', async (ctx) => {
  ctx.reply('👀 A analisar o teu talão de compras...')
  const responsavel = ctx.from.first_name || 'Família'

  try {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id
    const fileUrl = await ctx.telegram.getFileLink(fileId)
    
    const response = await axios.get(fileUrl.href, { responseType: 'arraybuffer' })
    const base64Image = Buffer.from(response.data, 'binary').toString('base64')

    const prompt = `Analisa esta imagem de um talão. Extrai os itens e devolve APENAS um array JSON: [{"item": "Nome", "quantidade": 1, "categoria": "Mercearia", "preco": 10.50}]. Retorna SÓ o JSON e mais nada.`
    
    const result = await model.generateContent([ prompt, { inlineData: { data: base64Image, mimeType: "image/jpeg" } } ])
    
    let jsonString = result.response.text().trim()
    if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3)
    if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3)
    
    const itens = JSON.parse(jsonString)
    let inseridos = 0
    let msgResposta = "✅ *Itens Lidos do Talão:*\n"

    for (const produto of itens) {
      const { item, quantidade, categoria, preco } = produto
      const precoUnit = preco / (quantidade || 1)

      await supabase.from('despensa').insert([{ item, quantidade: quantidade || 1, categoria: categoria || 'Mercearia', local: 'Armário', preco_unitario: precoUnit }])
      await supabase.from('historico_movimentacoes').insert([{ item, tipo_movimento: 'entrada', quantidade: quantidade || 1, preco_unitario: precoUnit, responsavel }])
      
      inseridos++
      msgResposta += `- ${item} (x${quantidade || 1}) | R$ ${preco.toFixed(2)}\n`
    }
    ctx.replyWithMarkdown(msgResposta + `\nTotal registado: ${inseridos} itens. Já está no Dashboard!`)
  } catch (error) {
    console.error(error)
    ctx.reply('❌ Ups! Tive dificuldade em ler esta imagem. Consegues tentar enviar uma foto um bocadinho mais nítida, por favor?')
  }
})

// === 3. MÓDULO DE AUDIÇÃO (VOZ) ===
bot.on('voice', async (ctx) => {
  ctx.reply('🎧 A escutar o teu áudio com atenção...')
  const responsavel = ctx.from.first_name || 'Família'

  try {
    const fileId = ctx.message.voice.file_id
    const fileUrl = await ctx.telegram.getFileLink(fileId)
    const response = await axios.get(fileUrl.href, { responseType: 'arraybuffer' })
    const base64Audio = Buffer.from(response.data, 'binary').toString('base64')

    const prompt = `
      Ouve este áudio de registo de despensa. 
      Extrai os itens comprados e devolve APENAS um array JSON válido.
      Formato exigido: [{"item": "Nome do Produto", "quantidade": 1, "categoria": "Genérica", "preco": 10.50}]
      Se o preço não for dito, mete 0. Infere a categoria. Devolve SÓ o JSON sem markdown.
    `
    
    const result = await model.generateContent([ prompt, { inlineData: { data: base64Audio, mimeType: "audio/ogg" } } ])
    
    let jsonString = result.response.text().trim()
    if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3)
    if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3)
    
    const itens = JSON.parse(jsonString)
    let inseridos = 0
    let msgResposta = "✅ *Itens Lidos da Voz:*\n"

    for (const produto of itens) {
      const { item, quantidade, categoria, preco } = produto
      const precoFinal = preco || 0
      const precoUnit = precoFinal / (quantidade || 1)

      await supabase.from('despensa').insert([{ item, quantidade: quantidade || 1, categoria: categoria || 'Mercearia', local: 'Armário', preco_unitario: precoUnit }])
      await supabase.from('historico_movimentacoes').insert([{ item, tipo_movimento: 'entrada', quantidade: quantidade || 1, preco_unitario: precoUnit, responsavel }])
      
      inseridos++
      msgResposta += `- ${item} (x${quantidade || 1}) | R$ ${precoFinal.toFixed(2)}\n`
    }
    ctx.replyWithMarkdown(msgResposta + `\nTotal registado: ${inseridos} itens. Já está no Dashboard!`)
  } catch (error) {
    console.error(error)
    ctx.reply('❌ Desculpa, não consegui perceber muito bem o áudio. Podes tentar falar um pouco mais devagar ou sem ruído de fundo?')
  }
})

bot.launch()
console.log('🤖 Bot Multimodal Familiar a funcionar...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
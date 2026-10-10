const { Telegraf } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const token = process.env.TELEGRAM_BOT_TOKEN
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN em falta no .env.local')
  process.exit(1)
}

const bot = new Telegraf(token)
const supabase = createClient(supabaseUrl, supabaseAnonKey)

bot.start((ctx) => {
  ctx.reply('📦 Olá! O Bot da Despensa Familiar está ativo.\n\nPodes enviar texto para adicionar itens (ex: "Arroz, 2kg, Mercearia, 15.90").')
})

bot.on('text', async (ctx) => {
  const texto = ctx.message.text
  const responsavel = ctx.from.first_name || 'Família'

  const partes = texto.split(',').map(p => p.trim())
  const item = partes[0]
  const quantidade = Number(partes[1]) || 1
  const categoria = partes[2] || 'Mercearia'
  const preco = Number(partes[3]) || 0

  try {
    await supabase.from('despensa').insert([
      { item, quantidade, categoria, local: 'Armário', preco_unitario: preco }
    ])

    await supabase.from('historico_movimentacoes').insert([
      { item, tipo_movimento: 'entrada', quantidade, preco_unitario: preco, responsavel }
    ])

    ctx.reply(`✅ Item registado com sucesso:\n- Produto: ${item}\n- Qtd: ${quantidade}\n- Categoria: ${categoria}\n- Preço: R$ ${preco.toFixed(2)}`)
  } catch (error) {
    console.error(error)
    ctx.reply('❌ Erro ao guardar o item na base de dados.')
  }
})

bot.launch()
console.log('🤖 Bot do Telegram a funcionar em modo de escuta...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
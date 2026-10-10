import { Telegraf } from 'telegraf'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Carregar variáveis do .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.TELEGRAM_BOT_TOKEN
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN em falta no .env.local')
}

const bot = new Telegraf(token)
const supabase = createClient(supabaseUrl!, supabaseAnonKey!)

bot.start((ctx) => {
  ctx.reply('📦 Olá! O Bot da Despensa Familiar está ativo.\n\nPodes enviar texto para adicionar itens (ex: "Arroz, 2kg, Mercearia, 15.90") ou tirar uma foto de um talão/produto.')
})

// Escutar mensagens de texto
bot.on('text', async (ctx) => {
  const texto = ctx.message.text
  const responsavel = ctx.from.first_name || 'Família'

  // Exemplo simples de parsing: Item, Qtd, Categoria, Preço
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

// Encerramento seguro
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

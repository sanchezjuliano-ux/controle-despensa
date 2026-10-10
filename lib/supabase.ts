import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Atenção: As variáveis de ambiente do Supabase estão em falta ou vazias!')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
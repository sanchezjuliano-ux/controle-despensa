'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function Home() {
  const [activeTab, setActiveTab] = useState<'despensa' | 'compras' | 'historico'>('despensa');
  const [inventario, setInventario] = useState<any[]>([]);
  const [listaCompras, setListaCompras] = useState<any[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [loadingIA, setLoadingIA] = useState(false);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [expandedItems, setExpandedItems] = useState<{ [key: string]: boolean }>({});

  // Estados do Formulário e Edição
  const [editingId, setEditingId] = useState<string | null>(null);
  const [item, setItem] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const [validade, setValidade] = useState('');
  const [categoria, setCategoria] = useState('Mercearia');
  const [local, setLocal] = useState('Armário');
  const [preco, setPreco] = useState('');
  const [loja, setLoja] = useState('');
  const [pagamento, setPagamento] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    const { data: despensaData } = await supabase.from('despensa').select('*').order('item', { ascending: true });
    if (despensaData) setInventario(despensaData);

    const { data: comprasData } = await supabase.from('lista_compras').select('*').order('id', { ascending: false });
    if (comprasData) setListaCompras(comprasData);

    const { data: historicoData } = await supabase.from('historico_movimentacoes').select('*').order('created_at', { ascending: false }).limit(50);
    if (historicoData) setHistorico(historicoData);
  }

  async function enviarAlertaTelegram(mensagem: string) {
    try {
      await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            chat: { id: process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID },
            text: mensagem
          }
        })
      });
    } catch (e) {
      console.error("Erro ao enviar alerta para o Telegram:", e);
    }
  }

  const comprimirImagem = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 800;

          if (width > height) {
            if (width > maxDim) {
              height *= maxDim / width;
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width *= maxDim / height;
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Falha ao comprimir imagem'));
            },
            'image/jpeg',
            0.75
          );
        };
        img.onerror = (error) => reject(error);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  async function handleAnalisarEtiqueta(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingIA(true);
    try {
      const blobComprimido = await comprimirImagem(file);
      const formData = new FormData();
      formData.append('image', blobComprimido, 'etiqueta.jpg');

      const res = await fetch('/api/analisar-etiqueta', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (json.success && json.data) {
        setItem(json.data.item || '');
        setPreco(json.data.preco ? json.data.preco.toString() : '');
        setQuantidade(json.data.quantidade || 1);
        if (json.data.categoria) setCategoria(json.data.categoria);
        setMostrarFormulario(true);
        alert('✨ Etiqueta lida com sucesso!');
      } else {
        alert('⚠️ ' + (json.error || 'Não foi possível extrair dados da etiqueta.'));
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao processar a imagem com IA.');
    } finally {
      setLoadingIA(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleGuardarStock(e: React.FormEvent) {
    e.preventDefault();
    if (!item.trim()) return alert('Insere o nome do item.');

    const precoNum = preco ? parseFloat(preco) : 0;
    const qtdNum = parseInt(quantidade.toString()) || 1;
    const precoUnit = precoNum / qtdNum;

    if (editingId) {
      await supabase.from('despensa').update({
        item,
        quantidade: qtdNum,
        validade: validade || null,
        categoria,
        local,
        preco_unitario: precoUnit
      }).eq('id', editingId);

      alert('✅ Item atualizado com sucesso!');
    } else {
      const { data: existente } = await supabase.from('despensa').select('*').ilike('item', `%${item}%`);

      if (existente && existente.length > 0) {
        const atual = existente[0];
        await supabase.from('despensa').update({
          quantidade: atual.quantidade + qtdNum,
          preco_unitario: precoUnit,
          validade: validade || atual.validade
        }).eq('id', atual.id);
      } else {
        await supabase.from('despensa').insert([{
          item,
          quantidade: qtdNum,
          validade: validade || null,
          categoria,
          local,
          preco_unitario: precoUnit
        }]);
      }

      await supabase.from('historico_movimentacoes').insert([{
        item,
        tipo_movimento: 'entrada',
        quantidade: qtdNum,
        preco_unitario: precoUnit,
        responsavel: 'Painel Web',
        loja: loja || 'Não informado',
        metodo_pagamento: pagamento || 'Não informado'
      }]);

      await supabase.from('lista_compras').delete().ilike('item', `%${item}%`);
      alert('✅ Guardado no stock com sucesso!');
    }

    setEditingId(null);
    setItem('');
    setQuantidade(1);
    setValidade('');
    setPreco('');
    setLoja('');
    setPagamento('');
    setMostrarFormulario(false);
    carregarDados();
  }

  async function iniciarEdicao(prod: any) {
    setEditingId(prod.id);
    setItem(prod.item || '');
    setQuantidade(prod.quantidade || 1);
    setValidade(prod.validade || '');
    setCategoria(prod.categoria || 'Mercearia');
    setLocal(prod.local || 'Armário');
    setPreco(prod.preco_unitario ? (prod.preco_unitario * prod.quantidade).toFixed(2) : '');
    setMostrarFormulario(true);
  }

  async function excluirItem(id: string, itemName: string) {
    if (!confirm(`Tens a certeza que queres eliminar "${itemName}" do inventário?`)) return;

    const { error } = await supabase.from('despensa').delete().eq('id', id);
    if (!error) {
      alert('🗑️ Item excluído com sucesso.');
      carregarDados();
    } else {
      alert('Erro ao excluir item.');
    }
  }

  async function darBaixa(id: string, currentQtd: number, itemName: string) {
    let novaQtd = currentQtd - 1;
    if (novaQtd < 0) novaQtd = 0;

    const updatePayload = novaQtd === 0 ? { quantidade: 0, validade: null } : { quantidade: novaQtd };
    await supabase.from('despensa').update(updatePayload).eq('id', id);

    await supabase.from('historico_movimentacoes').insert([{
      item: itemName,
      tipo_movimento: 'saida',
      quantidade: 1,
      preco_unitario: 0,
      responsavel: 'Painel Web'
    }]);

    if (novaQtd === 0) {
      await supabase.from('lista_compras').insert([{ item: itemName }]);
      await enviarAlertaTelegram(`🚨 ALERTA DESPENSA: O item *${itemName}* ACABOU e foi movido para a lista de compras!`);
    } else if (novaQtd === 1) {
      await enviarAlertaTelegram(`⚠️ ALERTA DESPENSA: O item *${itemName}* está a ACABAR (Resta apenas 1 unidade).`);
    }

    carregarDados();
  }

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">
      {/* BARRA LATERAL (Sidebar vertical no PC / Barra superior em linha única no Telemóvel) */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 p-4 md:p-5 flex flex-col md:justify-between">
        <div className="flex flex-col md:flex-row md:items-center justify-between">
          <div className="flex items-center gap-2 mb-4 md:mb-8">
            <span className="text-xl md:text-2xl">📦</span>
            <h1 className="text-base md:text-lg font-bold text-slate-100">Controle Despensa</h1>
          </div>

          {/* Navegação: Linha única scrollável no telemóvel, vertical no PC */}
          <nav className="flex md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            <button
              onClick={() => setActiveTab('despensa')}
              className={`whitespace-nowrap px-3.5 py-2.5 md:px-4 md:py-3 rounded-xl font-medium text-xs md:text-sm transition flex items-center gap-2 md:gap-3 shrink-0 ${
                activeTab === 'despensa' 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📦</span> <span className="inline">Despensa / Stock</span>
            </button>

            <button
              onClick={() => setActiveTab('compras')}
              className={`whitespace-nowrap px-3.5 py-2.5 md:px-4 md:py-3 rounded-xl font-medium text-xs md:text-sm transition flex items-center gap-2 md:gap-3 shrink-0 ${
                activeTab === 'compras' 
                  ? 'bg-amber-600 text-white shadow-lg shadow-amber-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>🛒</span> <span className="inline">Lista de Compras</span>
            </button>

            <button
              onClick={() => setActiveTab('historico')}
              className={`whitespace-nowrap px-3.5 py-2.5 md:px-4 md:py-3 rounded-xl font-medium text-xs md:text-sm transition flex items-center gap-2 md:gap-3 shrink-0 ${
                activeTab === 'historico' 
                  ? 'bg-teal-600 text-white shadow-lg shadow-teal-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📊</span> <span className="inline">Histórico</span>
            </button>
          </nav>
        </div>

        <div className="hidden md:block mt-8 pt-4 border-t border-slate-800 text-xs text-slate-500 text-center">
          Sistema Ativo 24/7 🚀
        </div>
      </aside>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-5xl">
        
        {/* GUIA 1: DESPENSA */}
        {activeTab === 'despensa' && (
          <div className="space-y-6">
            
            {/* BOTÕES DE NOVO LANÇAMENTO E LEITOR DE IA */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg">
              <button
                onClick={() => {
                  setEditingId(null);
                  setItem('');
                  setQuantidade(1);
                  setValidade('');
                  setPreco('');
                  setMostrarFormulario(!mostrarFormulario);
                }}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 shadow"
              >
                <span>{mostrarFormulario ? '✕ Fechar Lançamento' : '➕ Novo Lançamento'}</span>
              </button>

              <div className="w-full sm:w-auto">
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  ref={fileInputRef} 
                  onChange={handleAnalisarEtiqueta} 
                  className="hidden" 
                />
                <button 
                  type="button" 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={loadingIA}
                  className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow transition disabled:opacity-50"
                >
                  {loadingIA ? '⏳ A ler etiqueta...' : '📸 Ler Etiqueta com IA'}
                </button>
              </div>
            </div>

            {/* CAIXA DE LANÇAMENTO / EDIÇÃO OCULTÁVEL */}
            {mostrarFormulario && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl animate-fadeIn">
                <h2 className="text-xl font-bold text-emerald-400 mb-4">
                  {editingId ? '✏️ Editar Item' : '📥 Novo Lançamento'}
                </h2>

                <form onSubmit={handleGuardarStock} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">Nome do Item</label>
                    <input 
                      type="text" 
                      value={item} 
                      onChange={e => setItem(e.target.value)} 
                      placeholder="Ex: Fósforo Pinheiro" 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none" 
                      required 
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Quantidade</label>
                    <input 
                      type="number" 
                      value={quantidade} 
                      onChange={e => setQuantidade(Number(e.target.value))} 
                      min="1" 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none" 
                      required 
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Preço Total (R$)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      value={preco} 
                      onChange={e => setPreco(e.target.value)} 
                      placeholder="0.00" 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Validade</label>
                    <input 
                      type="date" 
                      value={validade} 
                      onChange={e => setValidade(e.target.value)} 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none text-slate-300" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Categoria</label>
                    <select 
                      value={categoria} 
                      onChange={e => setCategoria(e.target.value)} 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none text-slate-300"
                    >
                      <option value="Mercearia">Mercearia</option>
                      <option value="Limpeza">Limpeza</option>
                      <option value="Higiene">Higiene</option>
                      <option value="Bebidas">Bebidas</option>
                      <option value="Outros">Outros</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Local</label>
                    <select 
                      value={local} 
                      onChange={e => setLocal(e.target.value)} 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none text-slate-300"
                    >
                      <option value="Armário">Armário</option>
                      <option value="Frigorífico">Frigorífico</option>
                      <option value="Despensa">Despensa</option>
                      <option value="Área de Serviço">Área de Serviço</option>
                    </select>
                  </div>

                  {!editingId && (
                    <>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Loja / Supermercado</label>
                        <input 
                          type="text" 
                          value={loja} 
                          onChange={e => setLoja(e.target.value)} 
                          placeholder="Ex: Tenda" 
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none" 
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">Forma de Pagamento</label>
                        <input 
                          type="text" 
                          value={pagamento} 
                          onChange={e => setPagamento(e.target.value)} 
                          placeholder="Ex: Cartão Tenda" 
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none" 
                        />
                      </div>
                    </>
                  )}

                  <div className="md:col-span-2 mt-2 flex gap-3">
                    <button 
                      type="submit" 
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 rounded-xl text-sm transition shadow-lg shadow-emerald-950"
                    >
                      {editingId ? 'Salvar Alterações' : 'Guardar no Stock'}
                    </button>
                    <button 
                      type="button"
                      onClick={() => setMostrarFormulario(false)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-3.5 rounded-xl text-sm transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* INVENTÁRIO ATUAL */}
            <div className="bg-slate-900
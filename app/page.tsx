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
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 p-3 md:p-5 flex flex-col md:justify-between">
        <div className="flex flex-col md:flex-row md:items-center justify-between">
          <div className="flex items-center gap-2 mb-2.5 md:mb-8">
            <span className="text-xl md:text-2xl">📦</span>
            <h1 className="text-sm md:text-lg font-bold text-slate-100 tracking-tight">Controle Despensa</h1>
          </div>

          <nav className="grid grid-cols-3 gap-1.5 md:flex md:flex-col md:gap-2 w-full">
            <button
              onClick={() => setActiveTab('despensa')}
              className={`px-2 py-2 md:px-4 md:py-3 rounded-xl font-medium text-[11px] sm:text-xs md:text-sm transition flex items-center justify-center md:justify-start gap-1 md:gap-3 text-center ${
                activeTab === 'despensa' 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📦</span> <span className="truncate">Despensa</span>
            </button>

            <button
              onClick={() => setActiveTab('compras')}
              className={`px-2 py-2 md:px-4 md:py-3 rounded-xl font-medium text-[11px] sm:text-xs md:text-sm transition flex items-center justify-center md:justify-start gap-1 md:gap-3 text-center ${
                activeTab === 'compras' 
                  ? 'bg-amber-600 text-white shadow-lg shadow-amber-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>🛒</span> <span className="truncate">Compras</span>
            </button>

            <button
              onClick={() => setActiveTab('historico')}
              className={`px-2 py-2 md:px-4 md:py-3 rounded-xl font-medium text-[11px] sm:text-xs md:text-sm transition flex items-center justify-center md:justify-start gap-1 md:gap-3 text-center ${
                activeTab === 'historico' 
                  ? 'bg-teal-600 text-white shadow-lg shadow-teal-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📊</span> <span className="truncate">Histórico</span>
            </button>
          </nav>
        </div>

        <div className="hidden md:block mt-8 pt-4 border-t border-slate-800 text-xs text-slate-500 text-center">
          Sistema Ativo 24/7 🚀
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-5xl">
        
        {activeTab === 'despensa' && (
          <div className="space-y-6">
            
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

            {mostrarFormulario && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
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

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl">
              <h2 className="text-xl font-bold text-emerald-400 mb-4">Inventário Atual</h2>
              
              {/* VISTA DE TELEMÓVEL (<768px) */}
              <div className="block md:hidden space-y-2.5">
                {inventario.map(prod => {
                  const isExpanded = expandedItems[prod.id];
                  const isCritical = prod.quantidade <= 1;

                  return (
                    <div 
                      key={prod.id} 
                      className={`border rounded-xl p-3 shadow transition ${
                        isCritical 
                          ? 'bg-red-950/40 border-red-800 text-red-100' 
                          : 'bg-slate-950 border-slate-800/80 text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-semibold text-sm truncate">{prod.item}</span>
                          <span className={`text-xs px-2 py-0.5 rounded font-bold shrink-0 ${isCritical ? 'bg-red-900 text-white' : 'bg-slate-800 text-slate-300'}`}>
                            x{prod.quantidade}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            onClick={() => darBaixa(prod.id, prod.quantidade, prod.item)}
                            className="bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-800 px-2 py-1 rounded-lg text-xs font-medium"
                            title="Consumir 1"
                          >
                            -1
                          </button>
                          <button 
                            onClick={() => iniciarEdicao(prod)}
                            className="bg-blue-950/80 hover:bg-blue-900 text-blue-300 border border-blue-800 p-1.5 rounded-lg text-xs"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button 
                            onClick={() => excluirItem(prod.id, prod.item)}
                            className="bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800 p-1.5 rounded-lg text-xs"
                            title="Excluir"
                          >
                            🗑️
                          </button>
                          <button 
                            onClick={() => toggleExpand(prod.id)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-1.5 rounded-lg text-xs font-bold"
                            title="Ver Detalhes"
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-xs text-slate-300 space-y-1">
                          <p>📅 Validade: <span className="text-slate-100">{prod.validade || 'Sem data'}</span></p>
                          <p>💰 Preço Unitário: <span className="text-slate-100">R$ {Number(prod.preco_unitario || 0).toFixed(2)}</span></p>
                          <p>🏷️ Categoria: <span className="text-slate-100">{prod.categoria || 'Mercearia'}</span></p>
                          <p>📍 Local: <span className="text-slate-100">{prod.local || 'Armário'}</span></p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {inventario.length === 0 && (
                  <p className="py-8 text-center text-slate-500 text-sm">Nenhum item registado na despensa.</p>
                )}
              </div>

              {/* VISTA DE PC (≥768px) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-xs">
                      <th className="pb-3">Item</th>
                      <th className="pb-3 text-center">Qtd</th>
                      <th className="pb-3">Validade</th>
                      <th className="pb-3">Preço Un.</th>
                      <th className="pb-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {inventario.map(prod => {
                      const isCritical = prod.quantidade <= 1;
                      return (
                        <tr key={prod.id} className={`hover:bg-slate-800/30 ${isCritical ? 'bg-red-950/20 text-red-200' : ''}`}>
                          <td className="py-3.5 font-medium">
                            {prod.item}
                            {prod.quantidade === 0 && <span className="ml-2 text-xs bg-red-950 text-red-400 px-2 py-0.5 rounded border border-red-800">Acabou</span>}
                            {prod.quantidade === 1 && <span className="ml-2 text-xs bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800">Acabando</span>}
                          </td>
                          <td className="py-3.5 text-center font-bold">{prod.quantidade}</td>
                          <td className="py-3.5 text-xs text-slate-400">{prod.validade || 'Sem data'}</td>
                          <td className="py-3.5 text-slate-300">R$ {Number(prod.preco_unitario || 0).toFixed(2)}</td>
                          <td className="py-3.5 text-right space-x-1.5">
                            <button 
                              onClick={() => darBaixa(prod.id, prod.quantidade, prod.item)}
                              className="bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-800 px-2.5 py-1.5 rounded-lg text-xs font-medium transition"
                              title="Consumir 1 unidade"
                            >
                              -1
                            </button>
                            <button 
                              onClick={() => iniciarEdicao(prod)}
                              className="bg-blue-950/60 hover:bg-blue-900 text-blue-300 border border-blue-800 px-2.5 py-1.5 rounded-lg text-xs font-medium transition"
                              title="Editar item"
                            >
                              ✏️ Editar
                            </button>
                            <button 
                              onClick={() => excluirItem(prod.id, prod.item)}
                              className="bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800 px-2.5 py-1.5 rounded-lg text-xs font-medium transition"
                              title="Excluir item"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {inventario.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500 text-sm">Nenhum item registado na despensa.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'compras' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-xl font-bold text-amber-400 mb-6">🛒 Lista de Compras (Itens Esgotados)</h2>
            <ul className="space-y-3">
              {listaCompras.map(c => (
                <li key={c.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex justify-between items-center text-sm">
                  <span className="font-medium text-slate-200">❌ {c.item}</span>
                  <span className="text-xs text-amber-500 bg-amber-950/40 border border-amber-900 px-3 py-1 rounded-full">Pendente</span>
                </li>
              ))}
              {listaCompras.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-10">Tudo em ordem! Nenhum item em falta na despensa.</p>
              )}
            </ul>
          </div>
        )}

        {activeTab === 'historico' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-xl font-bold text-teal-400 mb-6">📊 Histórico de Movimentações</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-xs">
                    <th className="pb-3">Data</th>
                    <th className="pb-3">Item</th>
                    <th className="pb-3">Tipo</th>
                    <th className="pb-3 text-center">Qtd</th>
                    <th className="pb-3">Loja</th>
                    <th className="pb-3">Responsável</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {historico.map(h => (
                    <tr key={h.id} className="hover:bg-slate-800/30">
                      <td className="py-3 text-xs text-slate-400">{new Date(h.created_at).toLocaleString('pt-BR')}</td>
                      <td className="py-3 font-medium text-slate-200">{h.item}</td>
                      <td className="py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full border ${h.tipo_movimento === 'entrada' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-red-950 text-red-400 border-red-800'}`}>
                          {h.tipo_movimento}
                        </span>
                      </td>
                      <td className="py-3 text-center font-bold">{h.quantidade}</td>
                      <td className="py-3 text-xs text-slate-400">{h.loja || '-'}</td>
                      <td className="py-3 text-xs text-slate-400">{h.responsavel || '-'}</td>
                    </tr>
                  ))}
                  {historico.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-sm">Nenhum registo no histórico.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
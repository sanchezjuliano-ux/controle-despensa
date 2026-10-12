'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function GestaoDespensa() {
  const [abaAtiva, setAbaAtiva] = useState<'despensa' | 'compras' | 'historico'>('despensa');
  const [loading, setLoading] = useState(true);
  const [processandoCompra, setProcessandoCompra] = useState(false);

  const [itens, setItens] = useState<any[]>([]);
  const [compras, setCompras] = useState<any[]>([]);
  const [historicoCompras, setHistoricoCompras] = useState<any[]>([]);

  const [nome, setNome] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [categoria, setCategoria] = useState('Mercearia');
  const [local, setLocal] = useState('Armário');
  const [preco, setPreco] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutLoja, setCheckoutLoja] = useState('');
  const [checkoutPagamento, setCheckoutPagamento] = useState('Cartão de Crédito');
  const [checkoutResponsavel, setCheckoutResponsavel] = useState('Sanchez');

  const [buscaHistorico, setBuscaHistorico] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    buscarItens();
    buscarCompras();
    buscarHistorico();
  }, []);

  const buscarItens = async () => {
    const { data } = await supabase.from('despensa').select('*').order('id', { ascending: false });
    setItens(data || []);
    setLoading(false);
  };

  const buscarCompras = async () => {
    const { data: lista } = await supabase.from('lista_compras').select('*').order('id', { ascending: false });
    if (!lista) return;

    const listaEnriquecida = await Promise.all(lista.map(async (compra) => {
      const { data: history } = await supabase
        .from('historico_movimentacoes')
        .select('preco_unitario')
        .ilike('item', compra.item.trim())
        .eq('tipo_movimento', 'entrada')
        .order('id', { ascending: false });

      let ultimo = 0; 
      let medio = 0;
      if (history && history.length > 0) {
        ultimo = history[0].preco_unitario || 0;
        const soma = history.reduce((acc, curr) => acc + Number(curr.preco_unitario || 0), 0);
        medio = soma / history.length;
      }
      return { ...compra, ultimo_preco: ultimo, preco_medio: medio, qtd_compra: compra.quantidade || 1, preco_compra: '' };
    }));
    setCompras(listaEnriquecida);
  };

  const buscarHistorico = async () => {
    const { data, error } = await supabase.from('compras_realizadas').select('*').order('id', { ascending: false });
    if (error) {
      console.error("ERRO AO CARREGAR HISTÓRICO:", error);
    }
    setHistoricoCompras(data || []);
  };

  const adicionarItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const nomeLimpo = nome.trim();
    const precoNum = parseFloat(preco.replace(',', '.')) || 0;

    const { data: existente } = await supabase
      .from('despensa')
      .select('*')
      .ilike('item', nomeLimpo)
      .maybeSingle();

    if (existente) {
      const novaQtd = Number(existente.quantidade || 0) + Number(quantidade);
      await supabase.from('despensa').update({
        quantidade: novaQtd,
        preco_unitario: precoNum > 0 ? precoNum : existente.preco_unitario,
        categoria,
        local
      }).eq('id', existente.id);
    } else {
      await supabase.from('despensa').insert([{ 
        item: nomeLimpo, 
        quantidade: Number(quantidade), 
        categoria, 
        local, 
        preco_unitario: precoNum 
      }]);
    }

    setNome(''); 
    setQuantidade('1'); 
    setPreco(''); 
    buscarItens();
  };

  const darBaixaDespensa = async (item: any) => {
    await supabase.from('lista_compras').insert([{ item: item.item.trim(), quantidade: 1, categoria: item.categoria, local: item.local, preco_unitario: item.preco_unitario }]);
    await supabase.from('despensa').delete().eq('id', item.id);
    buscarItens(); 
    buscarCompras();
  };

  const iniciarEdicao = (item: any) => { setEditingId(item.id); setEditForm({ ...item }); };
  const cancelarEdicao = () => { setEditingId(null); };
  
  const salvarEdicao = async () => {
    const qtdFinal = Number(editForm.quantidade);
    const precoFinal = Number(editForm.preco_unitario);
    const nomeLimpo = editForm.item.trim();

    if (qtdFinal <= 0) {
      await supabase.from('lista_compras').insert([{ item: nomeLimpo, quantidade: 1, categoria: editForm.categoria, local: editForm.local, preco_unitario: precoFinal }]);
      await supabase.from('despensa').delete().eq('id', editingId);
    } else {
      await supabase.from('despensa').update({ 
        item: nomeLimpo, 
        quantidade: qtdFinal, 
        categoria: editForm.categoria, 
        local: editForm.local, 
        preco_unitario: precoFinal 
      }).eq('id', editingId);
    }
    cancelarEdicao(); 
    buscarItens(); 
    buscarCompras();
  };

  const atualizarCarrinho = (id: number, campo: string, valor: string) => {
    setCompras(compras.map(c => c.id === id ? { ...c, [campo]: valor } : c));
  };

  const apagarDaLista = async (id: number) => {
    await supabase.from('lista_compras').delete().eq('id', id);
    buscarCompras();
  };

  const abrirCheckout = () => {
    const itensComprados = compras.filter(c => parseFloat(String(c.preco_compra || '0').replace(',', '.')) > 0);
    if (itensComprados.length === 0) return alert('Aponta o valor de pelo menos um produto para finalizar a compra.');
    setShowCheckout(true);
  };

  const confirmarCompra = async () => {
    setProcessandoCompra(true);
    const itensComprados = compras.filter(c => parseFloat(String(c.preco_compra || '0').replace(',', '.')) > 0);
    const totalCalculado = itensComprados.reduce((acc, c) => acc + (Number(c.qtd_compra || 1) * parseFloat(String(c.preco_compra).replace(',', '.'))), 0);
    const dataAtual = new Date().toLocaleString('pt-BR');

    try {
      const arrayItensJSON = [];

      for (const compra of itensComprados) {
        const nomeLimpo = compra.item.trim();
        const precoFinal = parseFloat(String(compra.preco_compra).replace(',', '.'));
        const qtdFinal = Number(compra.qtd_compra) || 1;

        arrayItensJSON.push({ item: nomeLimpo, quantidade: qtdFinal, preco_unitario: precoFinal, categoria: compra.categoria });

        const { data: existente } = await supabase
          .from('despensa')
          .select('*')
          .ilike('item', nomeLimpo)
          .maybeSingle();

        if (existente) {
          const novaQuantidade = Number(existente.quantidade || 0) + qtdFinal;
          await supabase
            .from('despensa')
            .update({ 
              quantidade: novaQuantidade, 
              preco_unitario: precoFinal, 
              local: compra.local || existente.local, 
              categoria: compra.categoria || existente.categoria 
            })
            .eq('id', existente.id);
        } else {
          await supabase.from('despensa').insert([{ 
            item: nomeLimpo, 
            quantidade: qtdFinal, 
            categoria: compra.categoria, 
            local: compra.local || 'Armário', 
            preco_unitario: precoFinal 
          }]);
        }

        await supabase.from('historico_movimentacoes').insert([{ item: nomeLimpo, tipo_movimento: 'entrada', quantidade: qtdFinal, preco_unitario: precoFinal, responsavel: checkoutResponsavel }]);
        await supabase.from('lista_compras').delete().eq('id', compra.id);
      }
      
      const { error: erroHistorico } = await supabase.from('compras_realizadas').insert([{
        data_hora: dataAtual,
        estabelecimento: checkoutLoja || 'Não informado',
        forma_pagamento: checkoutPagamento,
        responsavel: checkoutResponsavel,
        valor_total: totalCalculado,
        itens: arrayItensJSON
      }]);

      if (erroHistorico) {
        console.error("ERRO FATAL AO GRAVAR O TALÃO:", erroHistorico);
        alert("Atenção! Erro ao guardar o Histórico: " + erroHistorico.message);
        setProcessandoCompra(false);
        return;
      }

      setShowCheckout(false);
      setCheckoutLoja('');
      buscarItens();
      buscarCompras();
      buscarHistorico();
      setAbaAtiva('historico');
    } catch (error) {
      console.error(error);
      alert('Ocorreu um erro geral ao processar o checkout.');
    } finally {
      setProcessandoCompra(false);
    }
  };

  const totalCarrinho = compras.reduce((acc, c) => acc + (Number(c.qtd_compra || 0) * parseFloat(String(c.preco_compra || 0).replace(',', '.'))), 0);
  const itensComPreco = compras.filter(c => parseFloat(String(c.preco_compra || '0').replace(',', '.')) > 0).length;

  const historicoFiltrado = historicoCompras.filter(h => {
    const termo = buscaHistorico.toLowerCase();
    return (
      (h.estabelecimento || '').toLowerCase().includes(termo) ||
      (h.responsavel || '').toLowerCase().includes(termo) ||
      (h.forma_pagamento || '').toLowerCase().includes(termo) ||
      (h.data_hora || '').toLowerCase().includes(termo)
    );
  });

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#0B0F19] text-gray-200 font-sans overflow-hidden">
      
      <aside className="w-full md:w-64 bg-[#111827] border-b md:border-b-0 md:border-r border-gray-800 flex flex-col shrink-0 z-20 shadow-md">
        <div className="p-4 md:p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">📦 Gestão Sanchez</h1>
        </div>
        <nav className="flex md:flex-col overflow-x-auto p-3 md:p-4 gap-2 md:space-y-2 whitespace-nowrap scrollbar-hide">
          <button onClick={() => setAbaAtiva('despensa')} className={`w-auto md:w-full text-left px-4 py-3 md:py-2.5 rounded-lg flex items-center gap-3 transition-colors ${abaAtiva === 'despensa' ? 'bg-blue-600/20 text-blue-400 font-medium' : 'hover:bg-gray-800/50 text-gray-400'}`}>
            📊 Inventário
          </button>
          <button onClick={() => setAbaAtiva('compras')} className={`w-auto md:w-full text-left px-4 py-3 md:py-2.5 rounded-lg flex items-center justify-between gap-3 transition-colors ${abaAtiva === 'compras' ? 'bg-orange-600/20 text-orange-400 font-medium' : 'hover:bg-gray-800/50 text-gray-400'}`}>
            <span className="flex items-center gap-2">🛒 <span className="hidden sm:inline">Lista de </span>Compras</span>
            {compras.length > 0 && <span className="bg-orange-500/20 text-orange-400 text-xs py-0.5 px-2 rounded-full">{compras.length}</span>}
          </button>
          <button onClick={() => setAbaAtiva('historico')} className={`w-auto md:w-full text-left px-4 py-3 md:py-2.5 rounded-lg flex items-center gap-3 transition-colors ${abaAtiva === 'historico' ? 'bg-purple-600/20 text-purple-400 font-medium' : 'hover:bg-gray-800/50 text-gray-400'}`}>
            📜 Histórico
          </button>
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto relative pb-24 md:pb-8 p-4 md:p-8">
        
        {showCheckout && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm p-0 md:p-4">
            <div className="bg-[#111827] border-t md:border border-gray-700 rounded-t-2xl md:rounded-xl p-6 w-full max-w-md shadow-2xl animate-slide-up md:animate-none">
              <h3 className="text-xl font-bold text-white mb-2">Finalizar Missão</h3>
              <p className="text-gray-400 text-sm mb-6">Total da operação: <span className="text-green-400 font-bold text-lg">R$ {totalCarrinho.toFixed(2)}</span></p>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">ONDE COMPRASTE?</label>
                  <input type="text" autoComplete="off" placeholder="Ex: Assaí, Carrefour
	
	
		
	
	
		 até 1,75% cashback
	
..." value={checkoutLoja} onChange={(e) => setCheckoutLoja(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">COMO FOI PAGO?</label>
                  <select value={checkoutPagamento} onChange={(e) => setCheckoutPagamento(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-green-500">
                    <option value="Cartão de Crédito">Cartão de Crédito</option>
                    <option value="Cartão de Débito">Cartão de Débito</option>
                    <option value="Dinheiro">Dinheiro Físico</option>
                    <option value="PIX">PIX</option>
                    <option value="Vale Alimentação">Vale Alimentação</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">QUEM COMPROU?</label>
                  <input type="text" autoComplete="off" value={checkoutResponsavel} onChange={(e) => setCheckoutResponsavel(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-green-500" />
                </div>
              </div>

              <div className="flex gap-3 mt-8 pb-4 md:pb-0">
                <button onClick={() => setShowCheckout(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-4 md:py-3 rounded-lg font-medium transition-colors">Cancelar</button>
                <button onClick={confirmarCompra} disabled={processandoCompra} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-4 md:py-3 rounded-lg transition-colors shadow-lg shadow-green-900/20">
                  {processandoCompra ? 'A gravar...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'despensa' && (
          <div className="max-w-6xl mx-auto space-y-6 md:space-y-8">
             <header><h2 className="text-2xl font-bold text-white">Inventário da Despensa</h2></header>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              <div className="bg-[#111827] border border-gray-800 rounded-xl p-5 md:p-6 h-fit shadow-sm">
                <h3 className="text-lg font-semibold text-white mb-5">Novo Lançamento</h3>
                <form onSubmit={adicionarItem} className="space-y-5">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">PRODUTO</label>
                    <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">QTD</label>
                      <input type="number" inputMode="numeric" pattern="[0-9]*" min="1" required value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">PREÇO (R$)</label>
                      <input type="text" inputMode="decimal" placeholder="0,00" value={preco} onChange={(e) => setPreco(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-xs font-medium text-gray-400 mb-1">CATEGORIA</label><select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-blue-500"><option>Mercearia</option><option>Bebidas</option><option>Limpeza</option><option>Talho</option><option>Outros</option></select></div>
                    <div><label className="block text-xs font-medium text-gray-400 mb-1">LOCAL</label><select value={local} onChange={(e) => setLocal(e.target.value)} className="w-full bg-[#0B0F19] border border-gray-800 rounded-lg px-4 py-3 md:py-2 text-white focus:outline-none focus:border-blue-500"><option>Armário</option><option>Frigorífico</option><option>Arca</option></select></div>
                  </div>
                  <button type="submit" className="w-full bg-[#059669] hover:bg-[#047857] text-white font-bold py-4 md:py-3 rounded-lg mt-4 shadow-md transition-colors">Guardar no Stock</button>
                </form>
              </div>

              <div className="lg:col-span-2 bg-[#111827] border border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse min-w-full">
                    <thead>
                      <tr className="border-b border-gray-800 text-[10px] md:text-xs text-gray-400 bg-gray-900/50">
                        <th className="p-4 uppercase">Item</th>
                        <th className="p-4 uppercase w-16 md:w-auto">Qtd</th>
                        <th className="hidden md:table-cell p-4 uppercase">Local</th>
                        <th className="hidden sm:table-cell p-4 uppercase">Preço</th>
                        <th className="p-4 uppercase text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? ( <tr><td colSpan={5} className="text-center py-8">A carregar...</td></tr> ) : itens.map((item) => (
                        <tr key={item.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          {editingId === item.id ? (
                            <>
                              <td className="p-3"><input type="text" className="bg-[#0B0F19] border border-gray-700 w-full min-w-[120px] text-sm rounded px-3 py-2" value={editForm.item} onChange={(e) => setEditForm({...editForm, item: e.target.value})} /></td>
                              <td className="p-3"><input type="number" inputMode="numeric" pattern="[0-9]*" className="bg-[#0B0F19] border border-gray-700 w-16 text-sm rounded px-2 py-2 text-center" value={editForm.quantidade} onChange={(e) => setEditForm({...editForm, quantidade: e.target.value})} /></td>
                              <td className="hidden md:table-cell p-3"><select className="bg-[#0B0F19] border border-gray-700 w-full text-sm rounded px-2 py-2 mb-1 block" value={editForm.local} onChange={(e) => setEditForm({...editForm, local: e.target.value})}><option>Armário</option><option>Frigorífico</option><option>Arca</option></select></td>
                              <td className="hidden sm:table-cell p-3"><input type="number" step="0.01" inputMode="decimal" className="bg-[#0B0F19] border border-gray-700 w-24 text-sm rounded px-2 py-2" value={editForm.preco_unitario} onChange={(e) => setEditForm({...editForm, preco_unitario: e.target.value})} /></td>
                              <td className="p-3">
                                <div className="flex flex-col sm:flex-row gap-2 justify-end">
                                  <button onClick={salvarEdicao} className="text-green-400 font-bold bg-green-900/20 px-4 py-2 rounded-lg">Ok</button>
                                  <button onClick={cancelarEdicao} className="text-gray-400 bg-gray-800 px-4 py-2 rounded-lg">X</button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-4">
                                <span className="font-medium text-gray-200 text-sm md:text-base block">{item.item}</span>
                                <span className="md:hidden text-[10px] text-gray-500">{item.local} • R$ {Number(item.preco_unitario || 0).toFixed(2)}</span>
                              </td>
                              <td className="p-4 text-gray-400 font-medium">{item.quantidade} <span className="text-[10px] text-gray-600">un</span></td>
                              <td className="hidden md:table-cell p-4"><span className="text-gray-500 text-xs block">{item.local}</span><span className="text-gray-400 text-xs">{item.categoria}</span></td>
                              <td className="hidden sm:table-cell p-4 text-green-400 whitespace-nowrap font-medium">R$ {Number(item.preco_unitario || 0).toFixed(2)}</td>
                              <td className="p-4">
                                <div className="flex items-center justify-end gap-3 md:gap-4">
                                  <button onClick={() => iniciarEdicao(item)} className="text-blue-400 text-sm font-medium py-2 px-1">Editar</button>
                                  <button onClick={() => darBaixaDespensa(item)} className="text-orange-400 text-sm font-bold bg-orange-900/20 px-3 py-2 rounded-lg">Baixa</button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'compras' && (
          <div className="max-w-6xl mx-auto space-y-6 md:pb-0 pb-16">
            <div className="hidden md:flex bg-orange-900/20 border border-orange-800/50 rounded-xl p-6 justify-between items-center">
              <div><h2 className="text-2xl font-bold text-orange-400">Calculadora de Compras</h2></div>
              <div className="flex items-end gap-6">
                <div className="text-right"><span className="text-gray-400 text-sm block mb-1">TOTAL DO CARRINHO</span><span className="text-4xl font-black text-white">R$ {totalCarrinho.toFixed(2)}</span></div>
                <button onClick={abrirCheckout} disabled={itensComPreco === 0} className={`px-8 py-4 rounded-xl font-bold transition-all shadow-lg text-lg ${itensComPreco > 0 ? 'bg-green-600 hover:bg-green-500 text-white transform hover:scale-105' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
                  Checkout ({itensComPreco})
                </button>
              </div>
            </div>

            <div className="bg-[#111827] md:border border-gray-800 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse min-w-full">
                  <thead>
                    <tr className="border-b border-gray-800 text-[9px] md:text-xs text-gray-400 bg-gray-900/50">
                      <th className="p-2 md:p-4 uppercase">Item</th>
                      {/* Removida a ocultação tática - Visão Absoluta no Mobile */}
                      <th className="p-2 md:p-4 uppercase text-center border-l border-gray-800/30">Últ.</th>
                      <th className="p-2 md:p-4 uppercase text-center border-r border-gray-800/30">Méd.</th>
                      <th className="p-2 md:p-4 uppercase text-blue-400 text-center w-12 md:w-24">Qtd</th>
                      <th className="p-2 md:p-4 uppercase text-blue-400 text-center w-24 md:w-40">Preço</th>
                      <th className="p-2 md:p-4 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {compras.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-500">O carrinho está vazio.</td></tr>
                    ) : (
                      compras.map((compra) => (
                        <tr key={compra.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="p-2 md:p-4">
                            <span className="font-bold text-orange-100 block text-xs md:text-lg truncate max-w-[80px] md:max-w-none">{compra.item}</span>
                            <span className="text-gray-500 text-[9px] md:text-xs uppercase tracking-wider hidden sm:block">{compra.categoria}</span>
                          </td>
                          <td className="p-2 md:p-4 text-center bg-gray-800/10 text-gray-400 text-[10px] md:text-sm font-medium border-l border-gray-800/30">R$ {compra.ultimo_preco.toFixed(2)}</td>
                          <td className="p-2 md:p-4 text-center bg-gray-800/10 text-gray-400 text-[10px] md:text-sm font-medium border-r border-gray-800/30">R$ {compra.preco_medio.toFixed(2)}</td>
                          <td className="p-2 md:p-4 text-center">
                            <input type="number" inputMode="numeric" pattern="[0-9]*" min="1" value={compra.qtd_compra} onChange={(e) => atualizarCarrinho(compra.id, 'qtd_compra', e.target.value)} className="w-10 md:w-16 bg-[#0B0F19] border border-blue-900/50 text-white font-bold px-1 py-2 md:py-2 rounded md:rounded-lg text-center text-xs md:text-base outline-none focus:border-blue-500 transition-colors" />
                          </td>
                          <td className="p-2 md:p-4">
                            <div className="relative flex items-center">
                              <span className="absolute left-1 md:left-3 text-gray-500 text-[10px] md:text-sm font-bold">R$</span>
                              <input type="text" inputMode="decimal" placeholder="0.00" value={compra.preco_compra} onChange={(e) => atualizarCarrinho(compra.id, 'preco_compra', e.target.value)} className={`w-full bg-[#0B0F19] border text-white font-bold pl-5 md:pl-8 pr-1 py-2 md:py-2 rounded md:rounded-lg text-center text-xs md:text-base focus:outline-none transition-colors ${parseFloat(String(compra.preco_compra).replace(',', '.')) > 0 ? 'border-green-500 bg-green-900/10' : 'border-blue-900/50 focus:border-blue-500'}`} />
                            </div>
                          </td>
                          <td className="p-1 md:p-4 text-right">
                            <button onClick={() => apagarDaLista(compra.id)} className="text-red-500/70 hover:text-red-400 p-1 md:p-2 text-lg md:text-xl font-bold">×</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0B0F19]/95 backdrop-blur-md border-t border-gray-800 p-4 z-40 flex justify-between items-center shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
               <div>
                 <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Carrinho</span>
                 <span className="text-2xl font-black text-white">R$ {totalCarrinho.toFixed(2)}</span>
               </div>
               <button onClick={abrirCheckout} disabled={itensComPreco === 0} className={`px-6 py-3.5 rounded-xl font-black text-sm uppercase tracking-wider transition-all shadow-lg ${itensComPreco > 0 ? 'bg-green-600 text-white active:scale-95' : 'bg-gray-800 text-gray-600'}`}>
                  Checkout ({itensComPreco})
               </button>
            </div>
          </div>
        )}

        {abaAtiva === 'historico' && (
          <div className="max-w-4xl mx-auto space-y-6 md:pb-10 pb-4">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-purple-400">Histórico Tático</h2>
                <p className="text-gray-400 text-xs md:text-sm mt-1">Registo absoluto das operações financeiras.</p>
              </div>
              <div className="w-full sm:w-72 relative">
                <span className="absolute left-4 top-3.5 md:top-2.5 text-gray-500">🔍</span>
                <input 
                  type="text" 
                  placeholder="Procurar loja, pessoa..." 
                  value={buscaHistorico} 
                  onChange={(e) => setBuscaHistorico(e.target.value)}
                  className="w-full bg-[#111827] border border-gray-700 rounded-xl md:rounded-lg pl-11 pr-4 py-3 md:py-2 text-white focus:outline-none focus:border-purple-500 shadow-sm" 
                />
              </div>
            </header>

            <div className="space-y-4">
              {historicoFiltrado.length === 0 ? (
                <div className="text-center py-16 text-gray-500 bg-[#111827] rounded-xl border border-gray-800">
                  Nenhum registo de compras encontrado.
                </div>
              ) : (
                historicoFiltrado.map((h) => {
                  let itensParsed = [];
                  try { itensParsed = typeof h.itens === 'string' ? JSON.parse(h.itens) : h.itens; } catch(e) {}
                  
                  const isExpanded = expandedId === h.id;

                  return (
                    <div key={h.id} className="bg-[#111827] border border-gray-800 rounded-xl overflow-hidden transition-all duration-300 shadow-sm">
                      
                      <div 
                        onClick={() => setExpandedId(isExpanded ? null : h.id)}
                        className="p-4 md:p-5 cursor-pointer active:bg-gray-800/60 hover:bg-gray-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 md:gap-4 w-full sm:w-auto">
                          <div className="bg-purple-900/30 p-3 md:p-4 rounded-xl text-purple-400 text-xl md:text-2xl">🛒</div>
                          <div>
                            <h3 className="text-base md:text-lg font-bold text-white truncate max-w-[220px] md:max-w-xs">{h.estabelecimento || 'Loja Desconhecida'}</h3>
                            <span className="text-gray-500 text-xs md:text-sm font-medium">{h.data_hora}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between w-full sm:w-auto gap-4 md:gap-8 border-t border-gray-800/50 sm:border-0 pt-3 sm:pt-0 mt-1 sm:mt-0">
                          <div className="text-left sm:text-right">
                            <span className="block text-[10px] md:text-xs text-gray-500 uppercase font-bold tracking-wider">Metódo / Resp.</span>
                            <span className="text-gray-300 text-xs md:text-sm font-medium">{h.forma_pagamento} • {h.responsavel}</span>
                          </div>
                          
                          <div className="text-right flex items-center gap-4">
                            <div>
                              <span className="block text-[10px] md:text-xs text-gray-500 uppercase font-bold tracking-wider">Total</span>
                              <span className="text-lg md:text-xl font-black text-white whitespace-nowrap">R$ {Number(h.valor_total).toFixed(2)}</span>
                            </div>
                            <div className="text-gray-600 bg-gray-900/50 p-2 rounded-lg">
                              {isExpanded ? '▲' : '▼'}
                            </div>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-gray-800 bg-[#0B0F19] p-4 md:p-5">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                             <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Detalhamento ({itensParsed.length})</h4>
                             
                             <div className="flex gap-2 w-full sm:w-auto">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    alert("Modo de edição do histórico a ser integrado. Edita na Despensa por enquanto.");
                                  }} 
                                  className="flex-1 sm:flex-none bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-900/50 px-4 py-3 sm:py-2 rounded-lg font-bold text-sm transition active:scale-95"
                                >
                                  Editar
                                </button>
                                <button 
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const confirmar = window.confirm("Certeza que desejas apagar este registo tático?");
                                    if (confirmar) {
                                      await supabase.from('compras_realizadas').delete().eq('id', h.id);
                                      buscarHistorico();
                                    }
                                  }} 
                                  className="flex-1 sm:flex-none bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-900/50 px-4 py-3 sm:py-2 rounded-lg font-bold text-sm transition active:scale-95"
                                >
                                  Apagar
                                </button>
                             </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                            {itensParsed.map((itemObj: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-center bg-[#111827] p-4 md:p-3 rounded-xl border border-gray-800/50 shadow-sm">
                                <div>
                                  <span className="text-gray-200 font-bold block text-sm md:text-base mb-0.5">{itemObj.item}</span>
                                  <span className="text-gray-500 text-[10px] md:text-xs font-medium uppercase tracking-wider">{itemObj.quantidade} un • {itemObj.categoria}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-green-400 font-black block text-sm md:text-base">R$ {Number(itemObj.preco_unitario).toFixed(2)}</span>
                                  <span className="text-gray-600 text-[10px] md:text-xs font-bold block mt-0.5">R$ {(itemObj.quantidade * itemObj.preco_unitario).toFixed(2)} total</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
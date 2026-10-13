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

  const [buscaDespensa, setBuscaDespensa] = useState('');
  const [buscaCompras, setBuscaCompras] = useState('');
  const [buscaHistorico, setBuscaHistorico] = useState('');

  const [expandedItems, setExpandedItems] = useState<{ [key: string]: boolean }>({});
  const [precosAtuais, setPrecosAtuais] = useState<{ [key: string]: string }>({});
  const [quantidadesCompra, setQuantidadesCompra] = useState<{ [key: string]: number }>({});

  // Listas dinâmicas de Categoria e Local para suportar novos registos salvos
  const [categoriasList, setCategoriasList] = useState<string[]>(['Mercearia', 'Limpeza', 'Higiene', 'Bebidas', 'Outros']);
  const [locaisList, setLocaisList] = useState<string[]>(['Armário', 'Frigorífico', 'Despensa', 'Área de Serviço']);

  // Estados auxiliares para inputs personalizados de Novo Local / Categoria
  const [modoNovoCategoria, setModoNovoCategoria] = useState(false);
  const [novoCategoriaInput, setNovoCategoriaInput] = useState('');
  const [modoNovoLocal, setModoNovoLocal] = useState(false);
  const [novoLocalInput, setNovoLocalInput] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [item, setItem] = useState('');
  const [quantidade, setQuantidade] = useState<string | number>(1);
  const [validade, setValidade] = useState('');
  const [categoria, setCategoria] = useState('Mercearia');
  const [local, setLocal] = useState('Armário');
  const [preco, setPreco] = useState('');
  const [loja, setLoja] = useState('');
  const [pagamento, setPagamento] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [comprasFileId, setComprasFileId] = useState<string | null>(null);
  const comprasFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    const { data: despensaData } = await supabase.from('despensa').select('*').order('item', { ascending: true });
    if (despensaData) {
      setInventario(despensaData);
      // Extrai dinamicamente categorias e locais já existentes na base de dados para enriquecer os selects
      const catsSet = new Set<string>(['Mercearia', 'Limpeza', 'Higiene', 'Bebidas', 'Outros']);
      const locsSet = new Set<string>(['Armário', 'Frigorífico', 'Despensa', 'Área de Serviço']);
      despensaData.forEach((d: any) => {
        if (d.categoria) catsSet.add(d.categoria);
        if (d.local) locsSet.add(d.local);
      });
      setCategoriasList(Array.from(catsSet));
      setLocaisList(Array.from(locsSet));
    }

    const { data: comprasData } = await supabase.from('lista_compras').select('*').order('id', { ascending: false });
    if (comprasData) {
      setListaCompras(comprasData);
      const qtdsIniciais: { [key: string]: number } = {};
      comprasData.forEach((c: any) => {
        qtdsIniciais[c.id] = c.quantidade_sugerida || 1;
      });
      setQuantidadesCompra(prev => ({ ...qtdsIniciais, ...prev }));
    }

    const { data: historicoData } = await supabase.from('historico_movimentacoes').select('*').order('created_at', { ascending: false }).limit(300);
    if (historicoData) setHistorico(historicoData);
  }

  function analisarItem(nomeItem: string, qtdAtual: number) {
    const movimentacoes = historico
      .filter(h => h.item && h.item.toLowerCase().includes(nomeItem.toLowerCase()))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    let totalDias = 0;
    let ciclos = 0;
    let ultimaEntrada: Date | null = null;
    const precosHistorico: { data: string; preco: number }[] = [];

    for (const mov of movimentacoes) {
      const dataMov = new Date(mov.created_at);
      if (mov.tipo_movimento === 'entrada') {
        ultimaEntrada = dataMov;
        if (mov.preco_unitario > 0) {
          precosHistorico.push({
            data: dataMov.toLocaleDateString('pt-BR'),
            preco: Number(mov.preco_unitario)
          });
        }
      } else if (mov.tipo_movimento === 'saida' && ultimaEntrada) {
        const diffDays = Math.ceil(Math.abs(dataMov.getTime() - ultimaEntrada.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          totalDias += diffDays;
          ciclos++;
        }
        ultimaEntrada = null;
      }
    }

    const mediaDiasConsumo = ciclos > 0 ? Math.round(totalDias / ciclos) : 0;
    
    let dataTerminoFmt = 'Indefinido';
    if (mediaDiasConsumo > 0 && qtdAtual > 0) {
      const diasRestantes = mediaDiasConsumo * qtdAtual;
      const dataEstimada = new Date();
      dataEstimada.setDate(dataEstimada.getDate() + diasRestantes);
      dataTerminoFmt = dataEstimada.toLocaleDateString('pt-BR');
    }

    const precosValidos = precosHistorico.map(p => p.preco);
    const menor = precosValidos.length > 0 ? Math.min(...precosValidos) : 0;
    const mediaPreco = precosValidos.length > 0 ? precosValidos.reduce((a, b) => a + b, 0) / precosValidos.length : 0;

    return {
      mediaDiasConsumo,
      dataTerminoFmt,
      menor,
      mediaPreco,
      precosHistorico
    };
  }

  function calcularSugestaoCompra(nomeItem: string) {
    const { mediaDiasConsumo } = analisarItem(nomeItem, 1);
    if (mediaDiasConsumo <= 0) return 1;
    const sugestao = Math.ceil(30 / mediaDiasConsumo);
    return sugestao < 1 ? 1 : sugestao;
  }

  const totalCalculadoraCompras = listaCompras.reduce((acc, c) => {
    const precoUnit = parseFloat(precosAtuais[c.id]) || 0;
    const qtdComprar = intToNumber(quantidadesCompra[c.id]);
    return acc + (precoUnit * qtdComprar);
  }, 0);

  function intToNumber(val: any) {
    const n = parseInt(val);
    return isNaN(n) || n < 1 ? 1 : n;
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

  async function finalizarCompra() {
    const itensParaFinalizar = listaCompras.filter(c => {
      const p = precosAtuais[c.id];
      return p !== undefined && p !== '' && !isNaN(parseFloat(p));
    });

    if (itensParaFinalizar.length === 0) {
      return alert('⚠️ Nenhum item da lista possui preço atual preenchido para finalizar.');
    }

    if (!confirm(`Tens a certeza que queres finalizar a compra de ${itensParaFinalizar.length} item(ns) com preço preenchido?`)) return;

    setLoadingIA(true);
    try {
      for (const c of itensParaFinalizar) {
        const precoUnit = parseFloat(precosAtuais[c.id]);
        const qtdComprar = intToNumber(quantidadesCompra[c.id]);
        const itemName = c.item;

        const { data: existente } = await supabase.from('despensa').select('*').ilike('item', `%${itemName}%`);

        if (existente && existente.length > 0) {
          const atual = existente[0];
          await supabase.from('despensa').update({
            quantidade: atual.quantidade + qtdComprar,
            preco_unitario: precoUnit
          }).eq('id', atual.id);
        } else {
          await supabase.from('despensa').insert([{
            item: itemName,
            quantidade: qtdComprar,
            categoria: 'Mercearia',
            local: 'Armário',
            preco_unitario: precoUnit
          }]);
        }

        await supabase.from('historico_movimentacoes').insert([{
          item: itemName,
          tipo_movimento: 'entrada',
          quantidade: qtdComprar,
          preco_unitario: precoUnit,
          responsavel: 'Painel Web (Compra)',
          loja: 'Supermercado',
          metodo_pagamento: 'Não informado'
        }]);

        await supabase.from('lista_compras').delete().eq('id', c.id);
      }

      const novosPrecos = { ...precosAtuais };
      itensParaFinalizar.forEach(c => delete novosPrecos[c.id]);
      setPrecosAtuais(novosPrecos);

      alert('🎉 Compra finalizada com sucesso! Os itens atualizados voltaram para a despensa.');
      carregarDados();
    } catch (err) {
      console.error(err);
      alert('Erro ao finalizar compra.');
    } finally {
      setLoadingIA(false);
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
        if (json.data.categoria) {
          if (!categoriasList.includes(json.data.categoria)) {
            setCategoriasList(prev => [...prev, json.data.categoria]);
          }
          setCategoria(json.data.categoria);
        }
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

  async function handleAnalisarEtiquetaCompras(e: React.ChangeEvent<HTMLInputElement>, compraId: string) {
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
      if (json.success && json.data && json.data.preco) {
        setPrecosAtuais(prev => ({ ...prev, [compraId]: json.data.preco.toString() }));
        alert(`✨ Preço atual detetado: R$ ${json.data.preco}`);
      } else {
        alert('⚠️ Não foi possível extrair o preço da etiqueta.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao processar imagem de preço.');
    } finally {
      setLoadingIA(false);
      if (comprasFileInputRef.current) comprasFileInputRef.current.value = '';
    }
  }

  async function handleGuardarStock(e: React.FormEvent) {
    e.preventDefault();
    if (!item.trim()) return alert('Insere o nome do item.');

    // Trata categoria e local personalizados se o utilizador adicionou novos
    let categoriaFinal = categoria;
    if (modoNovoCategoria && novoCategoriaInput.trim()) {
      categoriaFinal = novoCategoriaInput.trim();
      if (!categoriasList.includes(categoriaFinal)) {
        setCategoriasList(prev => [...prev, categoriaFinal]);
      }
    }

    let localFinal = local;
    if (modoNovoLocal && novoLocalInput.trim()) {
      localFinal = novoLocalInput.trim();
      if (!locaisList.includes(localFinal)) {
        setLocaisList(prev => [...prev, localFinal]);
      }
    }

    const precoNum = preco ? parseFloat(preco) : 0;
    const qtdNum = intToNumber(quantidade);
    const precoUnit = precoNum / qtdNum;

    if (editingId) {
      await supabase.from('despensa').update({
        item,
        quantidade: qtdNum,
        validade: validade || null,
        categoria: categoriaFinal,
        local: localFinal,
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
          validade: validade || atual.validade,
          categoria: categoriaFinal,
          local: localFinal
        }).eq('id', atual.id);
      } else {
        await supabase.from('despensa').insert([{
          item,
          quantidade: qtdNum,
          validade: validade || null,
          categoria: categoriaFinal,
          local: localFinal,
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
    setModoNovoCategoria(false);
    setNovoCategoriaInput('');
    setModoNovoLocal(false);
    setNovoLocalInput('');
    setMostrarFormulario(false);
    carregarDados();
  }

  async function iniciarEdicao(prod: any) {
    setEditingId(prod.id);
    setItem(prod.item || '');
    setQuantidade(prod.quantidade || 1);
    setValidade(prod.validade || '');
    if (prod.categoria && !categoriasList.includes(prod.categoria)) {
      setCategoriasList(prev => [...prev, prod.categoria]);
    }
    setCategoria(prod.categoria || 'Mercearia');
    if (prod.local && !locaisList.includes(prod.local)) {
      setLocaisList(prev => [...prev, prod.local]);
    }
    setLocal(prod.local || 'Armário');
    setPreco(prod.preco_unitario ? (prod.preco_unitario * prod.quantidade).toFixed(2) : '');
    setModoNovoCategoria(false);
    setModoNovoLocal(false);
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
      await supabase.from('lista_compras').insert([{ item: itemName, quantidade_sugerida: calcularSugestaoCompra(itemName) }]);
      await enviarAlertaTelegram(`🚨 ALERTA DESPENSA: O item *${itemName}* ACABOU e foi movido para a lista de compras!`);
    } else if (novaQtd === 1) {
      await enviarAlertaTelegram(`⚠️ ALERTA DESPENSA: O item *${itemName}* está a ACABAR (Resta apenas 1 unidade).`);
    }

    carregarDados();
  }

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const inventarioFiltrado = inventario.filter(prod => 
    prod.item.toLowerCase().includes(buscaDespensa.toLowerCase()) ||
    (prod.categoria && prod.categoria.toLowerCase().includes(buscaDespensa.toLowerCase())) ||
    (prod.local && prod.local.toLowerCase().includes(buscaDespensa.toLowerCase()))
  );

  const listaComprasFiltrada = listaCompras.filter(c => 
    c.item.toLowerCase().includes(buscaCompras.toLowerCase())
  );

  const historicoFiltrado = historico.filter(h => 
    h.item.toLowerCase().includes(buscaHistorico.toLowerCase()) ||
    (h.loja && h.loja.toLowerCase().includes(buscaHistorico.toLowerCase())) ||
    (h.responsavel && h.responsavel.toLowerCase().includes(buscaHistorico.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 p-3 md:p-5 flex flex-col md:justify-between shrink-0">
        <div className="flex flex-col md:flex-col justify-between w-full">
          <div className="flex items-center gap-2 mb-2 md:mb-6">
            <span className="text-xl md:text-2xl">📦</span>
            <h1 className="text-sm md:text-base font-bold text-slate-100 tracking-tight whitespace-nowrap">Controle Despensa</h1>
          </div>

          <nav className="grid grid-cols-3 gap-1 md:flex md:flex-col md:gap-2 w-full">
            <button
              onClick={() => setActiveTab('despensa')}
              className={`px-2 py-2 md:px-4 md:py-3 rounded-xl font-medium text-[11px] md:text-sm transition flex items-center justify-center md:justify-start gap-1.5 md:gap-3 text-center ${
                activeTab === 'despensa' 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>📦</span> <span className="truncate">Despensa</span>
            </button>

            <button
              onClick={() => setActiveTab('compras')}
              className={`px-2 py-2 md:px-4 md:py-3 rounded-xl font-medium text-[11px] md:text-sm transition flex items-center justify-center md:justify-start gap-1.5 md:gap-3 text-center ${
                activeTab === 'compras' 
                  ? 'bg-amber-600 text-white shadow-lg shadow-amber-950' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>🛒</span> <span className="truncate">Compras</span>
            </button>

            <button
              onClick={() => setActiveTab('historico')}
              className={`px-2 py-2 md:px-4 md:py-3 rounded-xl font-medium text-[11px] md:text-sm transition flex items-center justify-center md:justify-start gap-1.5 md:gap-3 text-center ${
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
        
        {/* GUIA 1: DESPENSA */}
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
                  setModoNovoCategoria(false);
                  setModoNovoLocal(false);
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
                      onChange={e => setQuantidade(e.target.value)} 
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

                  {/* CATEGORIA COM SUPORTE A NOVO REGISTO */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Categoria</label>
                    {!modoNovoCategoria ? (
                      <select 
                        value={categoria} 
                        onChange={e => {
                          if (e.target.value === '___novo___') {
                            setModoNovoCategoria(true);
                          } else {
                            setCategoria(e.target.value);
                          }
                        }} 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none text-slate-300"
                      >
                        {categoriasList.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                        <option value="___novo___" className="text-emerald-400 font-bold">+ Adicionar nova categoria...</option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={novoCategoriaInput} 
                          onChange={e => setNovoCategoriaInput(e.target.value)}
                          placeholder="Nome da nova categoria"
                          className="w-full bg-slate-950 border border-emerald-500 rounded-xl p-3 text-sm outline-none text-slate-100"
                          autoFocus
                        />
                        <button 
                          type="button" 
                          onClick={() => {
                            if (novoCategoriaInput.trim()) {
                              const novaCat = novoCategoriaInput.trim();
                              if (!categoriasList.includes(novaCat)) setCategoriasList([...categoriasList, novaCat]);
                              setCategoria(novaCat);
                            }
                            setModoNovoCategoria(false);
                            setNovoCategoriaInput('');
                          }}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 rounded-xl text-xs font-bold"
                        >
                          OK
                        </button>
                      </div>
                    )}
                  </div>

                  {/* LOCAL COM SUPORTE A NOVO REGISTO */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Local</label>
                    {!modoNovoLocal ? (
                      <select 
                        value={local} 
                        onChange={e => {
                          if (e.target.value === '___novo___') {
                            setModoNovoLocal(true);
                          } else {
                            setLocal(e.target.value);
                          }
                        }} 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none text-slate-300"
                      >
                        {locaisList.map(loc => (
                          <option key={loc} value={loc}>{loc}</option>
                        ))}
                        <option value="___novo___" className="text-emerald-400 font-bold">+ Adicionar novo local...</option>
                      </select>
                    ) : (
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={novoLocalInput} 
                          onChange={e => setNovoLocalInput(e.target.value)}
                          placeholder="Nome do novo local"
                          className="w-full bg-slate-950 border border-emerald-500 rounded-xl p-3 text-sm outline-none text-slate-100"
                          autoFocus
                        />
                        <button 
                          type="button" 
                          onClick={() => {
                            if (novoLocalInput.trim()) {
                              const novoLoc = novoLocalInput.trim();
                              if (!locaisList.includes(novoLoc)) setLocaisList([...locaisList, novoLoc]);
                              setLocal(novoLoc);
                            }
                            setModoNovoLocal(false);
                            setNovoLocalInput('');
                          }}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 rounded-xl text-xs font-bold"
                        >
                          OK
                        </button>
                      </div>
                    )}
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

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                <h2 className="text-xl font-bold text-emerald-400">Inventário Atual</h2>
                <div className="w-full sm:w-72">
                  <input 
                    type="text" 
                    value={buscaDespensa} 
                    onChange={e => setBuscaDespensa(e.target.value)}
                    placeholder="🔍 Pesquisar na despensa..." 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs focus:border-emerald-500 outline-none text-slate-200"
                  />
                </div>
              </div>
              
              <div className="block md:hidden space-y-2.5">
                {inventarioFiltrado.map(prod => {
                  const isExpanded = expandedItems[prod.id];
                  const isEsgotado = prod.quantidade === 0;
                  const stats = analisarItem(prod.item, prod.quantidade);

                  let alertaValidade = false;
                  if (prod.validade) {
                    const diffDiasValidade = Math.ceil((new Date(prod.validade).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDiasValidade <= 7 && diffDiasValidade >= 0) alertaValidade = true;
                  }

                  return (
                    <div 
                      key={prod.id} 
                      className={`border rounded-xl p-3 shadow transition ${
                        isEsgotado 
                          ? 'bg-red-950/40 border-red-800 text-red-100' 
                          : alertaValidade 
                          ? 'bg-amber-950/40 border-amber-800 text-amber-100'
                          : 'bg-slate-950 border-slate-800/80 text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-semibold text-sm truncate">{prod.item}</span>
                          <span className={`text-xs px-2 py-0.5 rounded font-bold shrink-0 ${isEsgotado ? 'bg-red-900 text-white' : 'bg-slate-800 text-slate-300'}`}>
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
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-xs text-slate-300 space-y-1.5 animate-fadeIn">
                          <p>📅 Validade: <span className={alertaValidade ? 'text-amber-400 font-bold' : 'text-slate-100'}>{prod.validade || 'Sem data'} {alertaValidade && '⚠️ Vence em breve!'}</span></p>
                          <p>💰 Preço Unitário: <span className="text-slate-100">{Number(prod.preco_unitario || 0).toFixed(2)}</span></p>
                          <p>⏳ Consumo Médio: <span className="text-emerald-400 font-medium">{stats.mediaDiasConsumo > 0 ? `Dura aprox. ${stats.mediaDiasConsumo} dias` : 'Calculando...'}</span></p>
                          <p>🔮 Previsão de Término: <span className="text-amber-400 font-medium">{stats.dataTerminoFmt}</span></p>
                          <p>🏷️ Categoria: <span className="text-slate-100">{prod.categoria || 'Mercearia'}</span></p>
                          <p>📍 Local: <span className="text-slate-100">{prod.local || 'Armário'}</span></p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {inventarioFiltrado.length === 0 && (
                  <p className="py-8 text-center text-slate-500 text-sm">Nenhum item encontrado.</p>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-xs">
                      <th className="pb-3">Item</th>
                      <th className="pb-3 text-center">Qtd</th>
                      <th className="pb-3">Validade</th>
                      <th className="pb-3">Consumo / Término</th>
                      <th className="pb-3">Preço Un.</th>
                      <th className="pb-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {inventarioFiltrado.map(prod => {
                      const isEsgotado = prod.quantidade === 0;
                      const stats = analisarItem(prod.item, prod.quantidade);
                      let alertaValidade = false;
                      if (prod.validade) {
                        const diffDiasValidade = Math.ceil((new Date(prod.validade).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                        if (diffDiasValidade <= 7 && diffDiasValidade >= 0) alertaValidade = true;
                      }

                      return (
                        <tr key={prod.id} className={`hover:bg-slate-800/30 ${isEsgotado ? 'bg-red-950/20 text-red-200' : alertaValidade ? 'bg-amber-950/20 text-amber-200' : ''}`}>
                          <td className="py-3.5 font-medium">
                            {prod.item}
                            {prod.quantidade === 0 && <span className="ml-2 text-xs bg-red-950 text-red-400 px-2 py-0.5 rounded border border-red-800">Acabou</span>}
                            {prod.quantidade === 1 && <span className="ml-2 text-xs bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800">Acabando</span>}
                          </td>
                          <td className="py-3.5 text-center font-bold">{prod.quantidade}</td>
                          <td className="py-3.5 text-xs text-slate-400">
                            {prod.validade || 'Sem data'}
                            {alertaValidade && <span className="block text-[10px] text-amber-400 font-bold">⚠️ Vence em breve</span>}
                          </td>
                          <td className="py-3.5 text-xs text-slate-300">
                            <span className="block text-emerald-400">{stats.mediaDiasConsumo > 0 ? `${stats.mediaDiasConsumo} dias/ciclo` : '-'}</span>
                            <span className="block text-[10px] text-slate-400">Acaba em: {stats.dataTerminoFmt}</span>
                          </td>
                          <td className="py-3.5 text-slate-300">{Number(prod.preco_unitario || 0).toFixed(2)}</td>
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
                    {inventarioFiltrado.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 text-sm">Nenhum item encontrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        )}

        {/* GUIA 2: LISTA DE COMPRAS */}
        {activeTab === 'compras' && (
          <div className="space-y-6">
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              ref={comprasFileInputRef} 
              onChange={(e) => comprasFileId && handleAnalisarEtiquetaCompras(e, comprasFileId)} 
              className="hidden" 
            />

            <div className="bg-gradient-to-r from-amber-950/80 to-slate-900 border border-amber-800/80 rounded-2xl p-4 md:p-6 shadow-xl flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>
                <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider">Calculadora do Carrinho</p>
                <h3 className="text-2xl md:text-3xl font-bold text-slate-100 mt-0.5">
                  R$ {totalCalculadoraCompras.toFixed(2)}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {listaCompras.length} {listaCompras.length === 1 ? 'item pendente' : 'itens pendentes'}
                </p>
              </div>

              <button
                type="button"
                onClick={finalizarCompra}
                disabled={loadingIA || totalCalculadoraCompras === 0}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-950 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>{loadingIA ? '⏳ A processar...' : '✅ Finalizar Compra'}</span>
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                <h2 className="text-xl font-bold text-amber-400">🛒 Lista de Compras (Itens Esgotados)</h2>
                <div className="w-full sm:w-72">
                  <input 
                    type="text" 
                    value={buscaCompras} 
                    onChange={e => setBuscaCompras(e.target.value)}
                    placeholder="🔍 Pesquisar nas compras..." 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs focus:border-amber-500 outline-none text-slate-200"
                  />
                </div>
              </div>
              
              <div className="space-y-3">
                {listaComprasFiltrada.map(c => {
                  const { menor, mediaPreco } = analisarItem(c.item, 0);
                  const precoAtualVal = precosAtuais[c.id] || '';
                  const qtdComprarVal = quantidadesCompra[c.id] !== undefined ? quantidadesCompra[c.id] : calcularSugestaoCompra(c.item);

                  return (
                    <div key={c.id} className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl space-y-2.5 shadow">
                      
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-sm text-slate-100 truncate pr-2">❌ {c.item}</span>
                        <span className="text-[10px] text-amber-500 bg-amber-950/40 border border-amber-900 px-2.5 py-0.5 rounded-full font-medium shrink-0">Pendente</span>
                      </div>

                      <div className="grid grid-cols-[1fr_1fr_80px_55px_42px] gap-1.5 items-center">
                        
                        <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800 text-center min-w-0">
                          <span className="block text-[9px] text-slate-400 uppercase tracking-wider">Menor</span>
                          <span className="font-bold text-emerald-400 text-xs truncate block">
                            {menor > 0 ? menor.toFixed(2) : '0.00'}
                          </span>
                        </div>

                        <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800 text-center min-w-0">
                          <span className="block text-[9px] text-slate-400 uppercase tracking-wider">Médio</span>
                          <span className="font-bold text-blue-400 text-xs truncate block">
                            {mediaPreco > 0 ? mediaPreco.toFixed(2) : '0.00'}
                          </span>
                        </div>

                        <div className="relative">
                          <span className="absolute left-1.5 top-2 text-[9px] text-slate-400">R$</span>
                          <input 
                            type="number" 
                            step="0.01" 
                            value={precoAtualVal} 
                            onChange={(e) => setPrecosAtuais({ ...precosAtuais, [c.id]: e.target.value })}
                            placeholder="Atual" 
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-5 pr-1 py-1.5 text-[11px] focus:border-amber-500 outline-none text-slate-200 text-center font-bold"
                            title="Preço Atual"
                          />
                        </div>

                        <div className="relative">
                          <span className="absolute left-1 top-2 text-[9px] text-slate-400">Qtd</span>
                          <input 
                            type="number" 
                            min="1"
                            value={qtdComprarVal} 
                            onChange={(e) => setQuantidadesCompra({ ...quantidadesCompra, [c.id]: intToNumber(e.target.value) })}
                            placeholder="Qtd" 
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-5 pr-1 py-1.5 text-[11px] focus:border-amber-500 outline-none text-amber-300 text-center font-bold"
                            title="Quantidade a Comprar"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setComprasFileId(c.id);
                            comprasFileInputRef.current?.click();
                          }}
                          disabled={loadingIA}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 px-1 rounded-lg text-[11px] font-semibold flex items-center justify-center shadow transition disabled:opacity-50 h-[31px]"
                          title="Ler etiqueta de preço com IA"
                        >
                          {loadingIA && comprasFileId === c.id ? '⏳' : '📸'}
                        </button>

                      </div>

                    </div>
                  );
                })}

                {listaComprasFiltrada.length === 0 && (
                  <p className="text-slate-500 text-sm text-center py-10">Nenhum item encontrado.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* GUIA 3: HISTÓRICO */}
        {activeTab === 'historico' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <h2 className="text-xl font-bold text-teal-400">📊 Histórico de Movimentações</h2>
              <div className="w-full sm:w-72">
                <input 
                  type="text" 
                  value={buscaHistorico} 
                  onChange={e => setBuscaHistorico(e.target.value)}
                  placeholder="🔍 Pesquisar no histórico..." 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs focus:border-teal-500 outline-none text-slate-200"
                />
              </div>
            </div>

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
                  {historicoFiltrado.map(h => (
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
                  {historicoFiltrado.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-sm">Nenhum registo encontrado.</td>
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
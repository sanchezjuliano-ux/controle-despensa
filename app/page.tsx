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
  const [showFormMobile, setShowFormMobile] = useState(false);

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
  
  const [expandedInvId, setExpandedInvId] = useState<number | null>(null);

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
    setShowFormMobile(false); 
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
'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function Home() {
  const [inventario, setInventario] = useState<any[]>([]);
  const [listaCompras, setListaCompras] = useState<any[]>([]);
  const [loadingIA, setLoadingIA] = useState(false);

  // Estados do Formulário
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
  }

  // Função para comprimir a imagem no browser (Evita o erro 413 Payload Too Large na Vercel)
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
          const maxDim = 800; // Limita a resolução máxima para manter a imagem leve

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
            0.75 // Qualidade de compressão otimizada
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
      // Comprime a foto tirada pelo telemóvel antes de enviar
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

    setItem('');
    setQuantidade(1);
    setValidade('');
    setPreco('');
    setLoja('');
    setPagamento('');
    carregarDados();
    alert('✅ Guardado no stock com sucesso!');
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
    }

    carregarDados();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 sm:p-6 max-w-4xl mx-auto">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          📦 Controle Despensa
        </h1>
        <span className="text-xs bg-emerald-900/60 text-emerald-400 border border-emerald-700 px-3 py-1 rounded-full">
          Online 24/7
        </span>
      </header>

      {/* Formulário / Novo Lançamento com o teu layout original */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6 mb-6 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-emerald-400">Novo Lançamento</h2>
          
          <div>
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
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition disabled:opacity-50"
            >
              {loadingIA ? '⏳ A ler...' : '📸 Ler Etiqueta'}
            </button>
          </div>
        </div>

        <form onSubmit={handleGuardarStock} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Item</label>
            <input 
              type="text" 
              value={item} 
              onChange={e => setItem(e.target.value)} 
              placeholder="Nome do produto" 
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none" 
              required 
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Quantidade</label>
              <input 
                type="number" 
                value={quantidade} 
                onChange={e => setQuantidade(Number(e.target.value))} 
                min="1" 
                className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none" 
                required 
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Preço Total (R$)</label>
              <input 
                type="number" 
                step="0.01" 
                value={preco} 
                onChange={e => setPreco(e.target.value)} 
                placeholder="0.00" 
                className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none" 
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Validade</label>
            <input 
              type="date" 
              value={validade} 
              onChange={e => setValidade(e.target.value)} 
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none text-gray-300" 
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Categoria</label>
              <select 
                value={categoria} 
                onChange={e => setCategoria(e.target.value)} 
                className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none text-gray-300"
              >
                <option value="Mercearia">Mercearia</option>
                <option value="Limpeza">Limpeza</option>
                <option value="Higiene">Higiene</option>
                <option value="Bebidas">Bebidas</option>
                <option value="Outros">Outros</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Local</label>
              <select 
                value={local} 
                onChange={e => setLocal(e.target.value)} 
                className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none text-gray-300"
              >
                <option value="Armário">Armário</option>
                <option value="Frigorífico">Frigorífico</option>
                <option value="Despensa">Despensa</option>
                <option value="Área de Serviço">Área de Serviço</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Loja / Supermercado</label>
            <input 
              type="text" 
              value={loja} 
              onChange={e => setLoja(e.target.value)} 
              placeholder="Ex: Tenda" 
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none" 
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Forma de Pagamento</label>
            <input 
              type="text" 
              value={pagamento} 
              onChange={e => setPagamento(e.target.value)} 
              placeholder="Ex: Cartão Tenda" 
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-emerald-500 outline-none" 
            />
          </div>

          <button 
            type="submit" 
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg text-sm transition shadow-lg mt-2"
          >
            Guardar no Stock
          </button>
        </form>
      </section>

      {/* Inventário Atual com o layout original */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6 mb-6 shadow-xl">
        <h2 className="text-lg font-semibold text-emerald-400 mb-4">Inventário Atual</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="pb-3">Item</th>
                <th className="pb-3 text-center">Qtd</th>
                <th className="pb-3">Validade</th>
                <th className="pb-3">Preço Un.</th>
                <th className="pb-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {inventario.map(prod => (
                <tr key={prod.id} className="hover:bg-gray-800/30">
                  <td className="py-3 font-medium">
                    {prod.item}
                    {prod.quantidade === 0 && <span className="ml-2 text-xs bg-red-950 text-red-400 px-2 py-0.5 rounded border border-red-800">Acabou</span>}
                    {prod.quantidade === 1 && <span className="ml-2 text-xs bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800">Acabando</span>}
                  </td>
                  <td className="py-3 text-center font-bold">{prod.quantidade}</td>
                  <td className="py-3 text-xs text-gray-400">{prod.validade || 'Sem data'}</td>
                  <td className="py-3 text-gray-300">R$ {Number(prod.preco_unitario || 0).toFixed(2)}</td>
                  <td className="py-3 text-right">
                    <button 
                      onClick={() => darBaixa(prod.id, prod.quantidade, prod.item)}
                      className="bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800 px-3 py-1 rounded text-xs font-medium transition"
                    >
                      -1 Consumir
                    </button>
                  </td>
                </tr>
              ))}
              {inventario.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-500 text-sm">Nenhum item registado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lista de Compras */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-amber-400 mb-4">🛒 Lista de Compras (Itens Esgotados)</h2>
        <ul className="space-y-2">
          {listaCompras.map(c => (
            <li key={c.id} className="bg-gray-950 border border-gray-800 p-3 rounded-lg flex justify-between items-center text-sm">
              <span className="font-medium text-gray-200">❌ {c.item}</span>
              <span className="text-xs text-amber-500 bg-amber-950/40 border border-amber-900 px-2.5 py-1 rounded">Pendente</span>
            </li>
          ))}
          {listaCompras.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">Tudo em ordem! Nenhum item em falta.</p>
          )}
        </ul>
      </section>
    </div>
  );
}
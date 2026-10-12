import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-live-preview" });

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('image');

    if (!file) {
      return NextResponse.json({ error: 'Nenhuma imagem enviada.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString("base64");

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: file.type || "image/jpeg",
      },
    };

    const prompt = "Analisa esta imagem de uma etiqueta de preço ou produto de supermercado. Extrai estritamente num formato JSON puro (sem markdown extra): {\"item\": \"Nome do produto\", \"preco\": 0.00, \"quantidade\": 1, \"categoria\": \"Mercearia\"}. Se algum dado não estiver visível, estima com base no contexto ou deixa vazio/padrão.";

    const result = await model.generateContent([prompt, imagePart]);
    let text = result.response.text().trim();
    
    if (text.startsWith('```json')) text = text.slice(7, -3);
    if (text.startsWith('```')) text = text.slice(3, -3);

    const dadosExtraidos = JSON.parse(text);

    return NextResponse.json({ success: true, data: dadosExtraidos });
  } catch (error) {
    console.error("Erro ao analisar etiqueta:", error);
    return NextResponse.json({ error: 'Falha ao processar imagem com IA.' }, { status: 500 });
  }
}
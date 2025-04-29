import { GoogleGenAI } from '@google/genai'
if (require.main === module) {
  (async () => {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro-exp-03-25',
      contents: [{
        parts: [{
          text: `Hello, world!`
        }]
      }],
      config: {
        systemInstruction: 'You are an expert resume writer',
        maxOutputTokens: 65536,
      }
    })

    console.log(response.candidates?.[0]?.content?.parts?.[0]?.text)
  })();
}

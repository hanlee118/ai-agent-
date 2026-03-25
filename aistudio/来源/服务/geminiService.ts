import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface AgentIntent {
  keywords: string[];
  constraints: string[];
  risks: string[];
  suggestedTeam: string[];
}

export async function parseProjectIntent(requirement: string): Promise<AgentIntent> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following project requirement and extract key information for an AI agent team.
      Requirement: ${requirement}
      
      Return a JSON object with:
      - keywords: key terms
      - constraints: time, budget, or technical limits
      - risks: potential difficulties
      - suggestedTeam: roles needed from [PM, ANALYST, PRODUCT, ARCH, DEV, QA, HR]`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            constraints: { type: Type.ARRAY, items: { type: Type.STRING } },
            risks: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedTeam: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["keywords", "constraints", "risks", "suggestedTeam"],
        },
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Error parsing intent:", error);
    return {
      keywords: ["General Project"],
      constraints: ["None specified"],
      risks: ["Unknown"],
      suggestedTeam: ["PM", "DEV"]
    };
  }
}

export async function generateAgentThinking(agentRole: string, stage: string, context: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are an AI Agent with the role: ${agentRole}. 
      You are currently in the ${stage} stage of a project.
      Context: ${context}
      
      Generate a short "thinking process" snippet (1-2 sentences) about what you are doing right now.`,
    });
    return response.text;
  } catch (error) {
    return "Processing current task parameters...";
  }
}

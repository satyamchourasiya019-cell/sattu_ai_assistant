// src/askAi.ts

import { supabase } from "./supabaseClient";

export async function askAi(question: string) {
  console.log("========== ASK AI ==========");
  console.log("Question:", question);

  const { data, error } = await supabase.functions.invoke("ask-ai", {
    body: {
      question: question.trim(),
    },
  });

  console.log("DATA:", data);
  console.log("ERROR:", error);

  if (error) {
    console.error("FULL SUPABASE ERROR:", error);

    // Supabase FunctionsHttpError ke andar
    // actual Edge Function response ho sakta hai.
    try {
      const context = (error as any).context;

      if (context) {
        console.log("ERROR CONTEXT:", context);

        let serverBody = "";

        if (typeof context.text === "function") {
          serverBody = await context.text();
        } else if (typeof context.json === "function") {
          const json = await context.json();
          serverBody = JSON.stringify(json);
        }

        console.error(
          "EDGE FUNCTION RESPONSE:",
          serverBody
        );

        throw new Error(
          serverBody ||
            error.message ||
            "Edge Function failed."
        );
      }
    } catch (innerError) {
      console.error(
        "Could not read Edge Function error:",
        innerError
      );

      if (innerError instanceof Error) {
        throw innerError;
      }
    }

    throw new Error(
      error.message ||
        "Edge Function returned an error."
    );
  }

  if (!data) {
    throw new Error(
      "ask-ai returned empty data."
    );
  }

  if (data.error) {
    throw new Error(
      String(data.error)
    );
  }

  if (!data.answer) {
    throw new Error(
      "AI response received but answer is missing."
    );
  }

  return data;
}
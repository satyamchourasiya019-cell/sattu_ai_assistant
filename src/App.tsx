import { useState, useRef, useEffect } from "react";
import "./App.css";
import { askAi } from "./askAi";
import Login from "./Login";
import { supabase } from "./supabaseClient";

type Message = {
  role: "user" | "ai";
  text: string;
};

type VoiceLanguage = "hi-IN" | "en-IN";

function App() {
  // ==============================
  // LOGIN
  // ==============================

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(true);

  // ==============================
  // CHAT
  // ==============================

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // ==============================
  // VOICE
  // ==============================

  const [isListening, setIsListening] = useState(false);

  // Default language = Hindi
  const [voiceLang, setVoiceLang] =
    useState<VoiceLanguage>("hi-IN");

  // ==============================
  // REFS
  // ==============================

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const recognitionRef = useRef<any>(null);

  const questionRef = useRef("");

  // Prevent duplicate submission
  const voiceSubmittedRef = useRef(false);

  // ==============================
  // CHECK LOGIN
  // ==============================

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
      setCheckingLogin(false);
    });

    const {
      data: listener,
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // ==============================
  // AUTO SCROLL
  // ==============================

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  // ==============================
  // CLEANUP VOICE
  // ==============================

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore cleanup error
      }

      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Ignore cleanup error
      }
    };
  }, []);

  // ==============================
  // TEXT TO SPEECH
  // ==============================

  const speak = (text: string) => {
    if (!text.trim()) return;

    if (!("speechSynthesis" in window)) {
      console.warn("Speech synthesis not supported.");
      return;
    }

    // Stop previous speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Detect Hindi characters
    const hasHindi = /[\u0900-\u097F]/.test(text);

    if (hasHindi) {
      utterance.lang = "hi-IN";
    } else {
      utterance.lang = "en-IN";
    }

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onerror = (event) => {
      console.error("Speech synthesis error:", event);
    };

    window.speechSynthesis.speak(utterance);
  };

  // ==============================
  // ASK AI
  // ==============================

  const handleAsk = async (overrideText?: string) => {
    const textToSend = (
      overrideText !== undefined
        ? overrideText
        : question
    ).trim();

    if (!textToSend) return;

    // Stop any active voice recognition
    if (isListening) {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore
      }

      setIsListening(false);
    }

    // Clear error
    setError("");

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: textToSend,
      },
    ]);

    // Clear input
    setQuestion("");

    // Clear voice ref
    questionRef.current = "";

    setIsLoading(true);

    try {
      console.log("Sending question to AI:", textToSend);

      const result = await askAi(textToSend);

      console.log("AI response:", result);

      const aiAnswer =
        result?.answer ||
        result?.response ||
        result?.message ||
        JSON.stringify(result);

      if (!aiAnswer) {
        throw new Error("AI returned an empty response.");
      }

      // Add AI message
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: aiAnswer,
        },
      ]);

      // Speak AI answer
      speak(aiAnswer);
    } catch (err) {
  console.error("ASK AI ERROR:", err);

  const message =
    err instanceof Error
      ? err.message
      : String(err);

  setError(`AI Error: ${message}`);
} finally {
      setIsLoading(false);
    }
  };

  // ==============================
  // VOICE INPUT
  // ==============================

  const handleVoice = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    // Browser support check
    if (!SpeechRecognition) {
      setError(
        "Ye browser voice input support nahi karta. Chrome use karo."
      );

      return;
    }

    // ==============================
    // STOP LISTENING
    // ==============================

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch (err) {
        console.error("Stop recognition error:", err);
      }

      return;
    }

    // ==============================
    // STOP PREVIOUS INSTANCE
    // ==============================

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore
      }

      recognitionRef.current = null;
    }

    // ==============================
    // RESET
    // ==============================

    setError("");

    questionRef.current = "";

    voiceSubmittedRef.current = false;

    setQuestion("");

    // ==============================
    // CREATE RECOGNITION
    // ==============================

    const recognition = new SpeechRecognition();

    // HI / EN language
    recognition.lang = voiceLang;

    // One question at a time
    recognition.continuous = false;

    // Only final result
    recognition.interimResults = false;

    recognition.maxAlternatives = 1;

    // ==============================
    // START
    // ==============================

    recognition.onstart = () => {
      console.log(
        "Voice recognition started:",
        voiceLang
      );

      questionRef.current = "";

      voiceSubmittedRef.current = false;

      setIsListening(true);

      setError("");
    };

    // ==============================
    // RESULT
    // ==============================

    recognition.onresult = (event: any) => {
      try {
        const transcript =
          event.results?.[0]?.[0]?.transcript?.trim() || "";

        console.log(
          "Voice transcript:",
          transcript
        );

        if (!transcript) {
          return;
        }

        questionRef.current = transcript;

        setQuestion(transcript);
      } catch (err) {
        console.error(
          "Transcript processing error:",
          err
        );
      }
    };

    // ==============================
    // END
    // ==============================

    recognition.onend = () => {
      console.log("Voice recognition ended.");

      setIsListening(false);

      const finalText =
        questionRef.current.trim();

      console.log(
        "Final voice text:",
        finalText
      );

      // No speech
      if (!finalText) {
        return;
      }

      // Prevent duplicate submit
      if (voiceSubmittedRef.current) {
        return;
      }

      voiceSubmittedRef.current = true;

      // Automatically ask AI
      handleAsk(finalText);
    };

    // ==============================
    // ERROR
    // ==============================

    recognition.onerror = (event: any) => {
      console.error(
        "Speech recognition error:",
        event
      );

      setIsListening(false);

      const errorType = event?.error;

      // User manually stopped recognition
      if (errorType === "aborted") {
        return;
      }

      // Permission denied
      if (errorType === "not-allowed") {
        setError(
          "Microphone permission allow karo, phir dobara mic dabao."
        );

        return;
      }

      // Microphone unavailable
      if (errorType === "audio-capture") {
        setError(
          "Microphone nahi mil raha. Mic connected/check karo."
        );

        return;
      }

      // Nothing spoken
      if (errorType === "no-speech") {
        setError(
          "Kuch suna nahi. Mic dabao aur clearly bolo."
        );

        return;
      }

      // Network problem
      if (errorType === "network") {
        setError(
          "Voice recognition ke liye network problem aa rahi hai."
        );

        return;
      }

      // Service unavailable
      if (errorType === "service-not-allowed") {
        setError(
          "Voice recognition service available nahi hai."
        );

        return;
      }

      // Generic
      setError(
        `Voice error: ${errorType || "unknown"}`
      );
    };

    // ==============================
    // SAVE INSTANCE
    // ==============================

    recognitionRef.current = recognition;

    // ==============================
    // START RECOGNITION
    // ==============================

    try {
      recognition.start();
    } catch (err) {
      console.error(
        "Recognition start error:",
        err
      );

      setIsListening(false);

      setError(
        "Microphone start nahi ho paya. Dobara try karo."
      );
    }
  };

  // ==============================
  // LANGUAGE TOGGLE
  // ==============================

  const toggleVoiceLanguage = () => {
    // Don't change language while listening
    if (isListening) {
      setError(
        "Language change karne se pehle mic stop karo."
      );

      return;
    }

    setVoiceLang((current) =>
      current === "hi-IN"
        ? "en-IN"
        : "hi-IN"
    );

    setError("");
  };

  // ==============================
  // LOGOUT
  // ==============================

  const handleLogout = async () => {
    // Stop recognition
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore
    }

    // Stop speech
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // Ignore
    }

    setIsListening(false);

    await supabase.auth.signOut();
  };

  // ==============================
  // LOGIN CHECK
  // ==============================

  if (checkingLogin) {
    return <p>Loading...</p>;
  }

  if (!isLoggedIn) {
    return <Login />;
  }

  // ==============================
  // UI
  // ==============================

  return (
    <main className="app">

      {/* ==========================
          HEADER
      ========================== */}

      <header className="top-header">

        <button
          className="icon-button"
          aria-label="Open menu"
        >
          <span className="menu-line"></span>
          <span className="menu-line"></span>
          <span className="menu-line"></span>
        </button>

        <div className="header-title">
          <h1>SATTU AI ASSISTANT</h1>
          <p>Your Company Knowledge Assistant</p>
        </div>

        <button
          className="icon-button"
          aria-label="Logout"
          onClick={handleLogout}
        >
          Logout
        </button>

        <button
          className="history-button"
          aria-label="Chat history"
        >
          <span className="history-icon">
            ↶
          </span>
        </button>

      </header>

      {/* ==========================
          ASSISTANT AREA
      ========================== */}

      <section className="assistant-content">

        <div className="robot-area">

          <div className="robot-glow">

            <div className="robot">

              <div className="robot-antenna"></div>

              <div className="robot-head">

                <div className="robot-screen">

                  <span className="robot-eye"></span>

                  <span className="robot-eye"></span>

                  <span className="robot-smile"></span>

                </div>

              </div>

              <div className="robot-ear robot-ear-left"></div>

              <div className="robot-ear robot-ear-right"></div>

              <div className="robot-body"></div>

            </div>

          </div>

          <h2>Hello!</h2>

          <p>
            How can I help you today?
          </p>

        </div>

      </section>

      {/* ==========================
          CHAT / ASK AREA
      ========================== */}

      <section className="ask-container">

        {/* ========================
            MESSAGES
        ======================== */}

        <div className="chat-messages">

          {messages.map((msg, index) => (
            <p
              key={index}
              className={
                msg.role === "user"
                  ? "user-text"
                  : "answer-text"
              }
            >
              {msg.text}
            </p>
          ))}

          {isLoading && (
            <p className="helper-text">
              Soch raha hoon...
            </p>
          )}

          {error && (
            <p
              className="helper-text"
              style={{ color: "red" }}
            >
              {error}
            </p>
          )}

          <div ref={messagesEndRef} />

        </div>

        {/* ========================
            QUESTION BOX
        ======================== */}

        <div className="question-box">

          <textarea
            value={question}
            onChange={(event) =>
              setQuestion(event.target.value)
            }
            placeholder={
              isListening
                ? voiceLang === "hi-IN"
                  ? "Bolna shuru karo..."
                  : "Start speaking..."
                : "Ask anything..."
            }
            rows={1}
          />

          {/* ======================
              LANGUAGE BUTTON
          ====================== */}

          <button
            className="lang-toggle"
            onClick={toggleVoiceLanguage}
            disabled={isListening}
            aria-label="Change voice language"
            title={
              voiceLang === "hi-IN"
                ? "Voice language: Hindi"
                : "Voice language: English"
            }
          >
            {voiceLang === "hi-IN"
              ? "HI"
              : "EN"}
          </button>

          {/* ======================
              MICROPHONE BUTTON
          ====================== */}

          <button
            className={`voice-button ${
              isListening
                ? "listening"
                : ""
            }`}
            onClick={handleVoice}
            aria-label={
              isListening
                ? "Stop listening"
                : "Speak your question"
            }
            title={
              isListening
                ? "Stop listening"
                : voiceLang === "hi-IN"
                ? "Speak in Hindi"
                : "Speak in English"
            }
          >
            <span className="mic-icon">
              {isListening ? "■" : "●"}
            </span>
          </button>

        </div>

        {/* ========================
            ASK BUTTON
        ======================== */}

        <button
          className="ask-button"
          onClick={() => handleAsk()}
          disabled={isLoading}
        >
          <span className="sparkle">
            ✦
          </span>

          <span>
            {isLoading
              ? "Thinking..."
              : "Ask"}
          </span>

          <span className="arrow">
            →
          </span>
        </button>

        {/* ========================
            HELPER
        ======================== */}

        <p className="helper-text">
          {isListening
            ? voiceLang === "hi-IN"
              ? "Hindi mein bolo..."
              : "Speak in English..."
            : `Voice: ${
                voiceLang === "hi-IN"
                  ? "Hindi"
                  : "English"
              } • You can type or speak your question`}
        </p>

      </section>

    </main>
  );
}

export default App;
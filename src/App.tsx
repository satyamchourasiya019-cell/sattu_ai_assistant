import { useState, useRef, useEffect } from "react";
import "./App.css";
import { askAi } from "./askAi";
import Login from "./Login";
import { supabase } from "./supabaseClient";

type Message = {
  role: "user" | "ai";
  text: string;
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(true);

  const [question, setQuestion] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] =
    useState<"hi-IN" | "en-IN">("hi-IN");

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [conversations, setConversations] =
    useState<Conversation[]>([]);

  const [currentConversationId, setCurrentConversationId] =
    useState<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);

  const messagesEndRef =
    useRef<HTMLDivElement>(null);

  const recognitionRef =
    useRef<any>(null);

  const questionRef =
    useRef("");

  /* --------------------------------
     LOGIN
  -------------------------------- */

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
      setCheckingLogin(false);

      if (data.session) {
        loadHistory();
      }
    });

    const {
      data: listener,
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsLoggedIn(!!session);

        if (session) {
          loadHistory();
        } else {
          setMessages([]);
          setConversations([]);
        }
      }
    );

    return () =>
      listener.subscription.unsubscribe();
  }, []);

  /* --------------------------------
     AUTO SCROLL
  -------------------------------- */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  /* --------------------------------
     SPEECH
  -------------------------------- */

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();

    const isHindi =
      /[\u0900-\u097F]/.test(text);

    const utterance =
      new SpeechSynthesisUtterance(text);

    utterance.lang =
      isHindi ? "hi-IN" : "en-IN";

    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.speak(
      utterance
    );
  };

  /* --------------------------------
     LOAD 1-DAY HISTORY
  -------------------------------- */

  const loadHistory = async () => {
    try {
      const {
        data: userData,
      } = await supabase.auth.getUser();

      const user = userData.user;

      if (!user) return;

      const cutoff = new Date(
        Date.now() - ONE_DAY_MS
      ).toISOString();

      // Remove older than 24 hours
      await supabase
        .from("chat_history")
        .delete()
        .eq("user_id", user.id)
        .lt("created_at", cutoff);

      const {
        data,
        error: historyError,
      } = await supabase
        .from("chat_history")
        .select(
          "id, conversation_id, role, text, created_at"
        )
        .eq("user_id", user.id)
        .gte("created_at", cutoff)
        .order("created_at", {
          ascending: true,
        });

      if (historyError) {
        console.error(
          "History load error:",
          historyError
        );
        return;
      }

      if (!data) {
        setConversations([]);
        return;
      }

      /* Group messages into conversations */

      const grouped =
        new Map<string, any[]>();

      for (const row of data) {
        if (
          !grouped.has(
            row.conversation_id
          )
        ) {
          grouped.set(
            row.conversation_id,
            []
          );
        }

        grouped
          .get(row.conversation_id)!
          .push(row);
      }

      const conversationList:
        Conversation[] = [];

      grouped.forEach(
        (rows, conversationId) => {
          const firstUserMessage =
            rows.find(
              (row) =>
                row.role === "user"
            );

          conversationList.push({
            id: conversationId,
            title:
              firstUserMessage?.text
                ?.slice(0, 40) ||
              "New conversation",
            created_at:
              rows[0].created_at,
          });
        }
      );

      conversationList.sort(
        (a, b) =>
          new Date(
            b.created_at
          ).getTime() -
          new Date(
            a.created_at
          ).getTime()
      );

      setConversations(
        conversationList
      );
    } catch (err) {
      console.error(
        "History error:",
        err
      );
    }
  };

  /* --------------------------------
     SAVE MESSAGE
  -------------------------------- */

  const saveMessage = async (
    conversationId: string,
    role: "user" | "ai",
    text: string
  ) => {
    try {
      const {
        data: userData,
      } = await supabase.auth.getUser();

      const user = userData.user;

      if (!user) return;

      const {
        error: insertError,
      } = await supabase
        .from("chat_history")
        .insert({
          user_id: user.id,
          conversation_id:
            conversationId,
          role,
          text,
        });

      if (insertError) {
        console.error(
          "Save history error:",
          insertError
        );
      }
    } catch (err) {
      console.error(
        "History save error:",
        err
      );
    }
  };

  /* --------------------------------
     LOAD SELECTED CONVERSATION
  -------------------------------- */

  const openConversation = async (
    conversationId: string
  ) => {
    try {
      const {
        data: userData,
      } = await supabase.auth.getUser();

      const user = userData.user;

      if (!user) return;

      const cutoff = new Date(
        Date.now() - ONE_DAY_MS
      ).toISOString();

      const {
        data,
        error: loadError,
      } = await supabase
        .from("chat_history")
        .select("role, text, created_at")
        .eq("user_id", user.id)
        .eq(
          "conversation_id",
          conversationId
        )
        .gte("created_at", cutoff)
        .order("created_at", {
          ascending: true,
        });

      if (loadError) {
        console.error(
          "Conversation load error:",
          loadError
        );
        return;
      }

      const loadedMessages: Message[] =
        (data || []).map((row) => ({
          role: row.role as
            | "user"
            | "ai",
          text: row.text,
        }));

      setMessages(loadedMessages);

      setCurrentConversationId(
        conversationId
      );

      setShowHistory(false);
      setError("");
    } catch (err) {
      console.error(
        "Open conversation error:",
        err
      );
    }
  };

  /* --------------------------------
     NEW CHAT
  -------------------------------- */

  const newChat = () => {
    window.speechSynthesis?.cancel();

    setMessages([]);
    setQuestion("");
    setError("");
    setCurrentConversationId(null);
    setShowHistory(false);
  };

  /* --------------------------------
     DELETE CONVERSATION
  -------------------------------- */

  const deleteConversation = async (
    conversationId: string
  ) => {
    try {
      const {
        data: userData,
      } = await supabase.auth.getUser();

      const user = userData.user;

      if (!user) return;

      const {
        error: deleteError,
      } = await supabase
        .from("chat_history")
        .delete()
        .eq("user_id", user.id)
        .eq(
          "conversation_id",
          conversationId
        );

      if (deleteError) {
        console.error(
          "Delete history error:",
          deleteError
        );
        return;
      }

      setConversations((prev) =>
        prev.filter(
          (item) =>
            item.id !==
            conversationId
        )
      );

      if (
        currentConversationId ===
        conversationId
      ) {
        newChat();
      }
    } catch (err) {
      console.error(
        "Delete conversation error:",
        err
      );
    }
  };

  /* --------------------------------
     ASK AI
  -------------------------------- */

  const handleAsk = async (
    overrideText?: string
  ) => {
    const textToSend =
      overrideText ?? question;

    if (!textToSend.trim()) return;

    setError("");

    let conversationId =
      currentConversationId;

    if (!conversationId) {
      conversationId =
        crypto.randomUUID();

      setCurrentConversationId(
        conversationId
      );
    }

    const cleanText =
      textToSend.trim();

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: cleanText,
      },
    ]);

    setQuestion("");
    setIsLoading(true);

    // Save user message
    await saveMessage(
      conversationId,
      "user",
      cleanText
    );

    try {
      const result =
        await askAi(cleanText);

      const aiAnswer =
        result?.answer ||
        "Mujhe iska answer nahi mil paya.";

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: aiAnswer,
        },
      ]);

      // Save AI message
      await saveMessage(
        conversationId,
        "ai",
        aiAnswer
      );

      speak(aiAnswer);

      // Refresh sidebar
      await loadHistory();
    } catch (err) {
      console.error(
        "AI error:",
        err
      );

      const message =
        err instanceof Error
          ? err.message
          : "";

      if (
        message.includes("429")
      ) {
        setError(
          "AI ki free limit temporarily reach ho gayi hai. Thodi der baad dobara try karo."
        );
      } else {
        setError(
          "AI se response lene mein problem hui. Dobara try karo."
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  /* --------------------------------
     VOICE
  -------------------------------- */

  const handleVoice = () => {
    const SpeechRecognition =
      (window as any)
        .SpeechRecognition ||
      (window as any)
        .webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        "Ye browser voice input support nahi karta."
      );
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition =
      new SpeechRecognition();

    recognition.lang = voiceLang;
    recognition.continuous = false;
    recognition.interimResults = true;

    questionRef.current = "";

    recognition.onstart = () => {
      setError("");
      setIsListening(true);
    };

    recognition.onresult = (
      event: any
    ) => {
      let transcript = "";

      for (
        let i = 0;
        i < event.results.length;
        i++
      ) {
        transcript +=
          event.results[i][0]
            .transcript;
      }

      questionRef.current =
        transcript;

      setQuestion(transcript);
    };

    recognition.onend = () => {
      setIsListening(false);

      const finalText =
        questionRef.current.trim();

      if (finalText) {
        handleAsk(finalText);
      }
    };

    recognition.onerror = (
      event: any
    ) => {
      console.error(
        "Speech recognition error:",
        event
      );

      setIsListening(false);

      if (
        event.error !==
        "aborted"
      ) {
        setError(
          "Voice sunne mein problem hui. Dobara try karo."
        );
      }
    };

    recognitionRef.current =
      recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error(
        "Recognition start error:",
        err
      );
    }
  };

  /* --------------------------------
     LOGOUT
  -------------------------------- */

  const handleLogout = async () => {
    window.speechSynthesis?.cancel();

    await supabase.auth.signOut();

    setMessages([]);
    setConversations([]);
    setCurrentConversationId(null);
  };

  /* --------------------------------
     LOADING
  -------------------------------- */

  if (checkingLogin) {
    return <p>Loading...</p>;
  }

  if (!isLoggedIn) {
    return <Login />;
  }

  /* --------------------------------
     UI
  -------------------------------- */

  return (
    <main className="app">

      {/* SIDEBAR */}

      {showHistory && (
        <aside className="history-sidebar">

          <div className="history-header">
            <h3>Chat History</h3>

            <button
              onClick={() =>
                setShowHistory(false)
              }
            >
              ✕
            </button>
          </div>

          <button
            className="new-chat-button"
            onClick={newChat}
          >
            + New Chat
          </button>

          <div className="history-list">

            {conversations.length ===
              0 && (
              <p className="helper-text">
                Last 24 hours mein
                koi chat nahi hai.
              </p>
            )}

            {conversations.map(
              (conversation) => (
                <div
                  key={
                    conversation.id
                  }
                  className={`history-item ${
                    currentConversationId ===
                    conversation.id
                      ? "active"
                      : ""
                  }`}
                >
                  <button
                    className="history-item-main"
                    onClick={() =>
                      openConversation(
                        conversation.id
                      )
                    }
                  >
                    {conversation.title}
                  </button>

                  <button
                    className="history-delete"
                    onClick={() =>
                      deleteConversation(
                        conversation.id
                      )
                    }
                    aria-label="Delete chat"
                  >
                    🗑
                  </button>
                </div>
              )
            )}
          </div>

        </aside>
      )}

      {/* HEADER */}

      <header className="top-header">

        <button
          className="icon-button"
          aria-label="Chat history"
          onClick={() =>
            setShowHistory(
              !showHistory
            )
          }
        >
          ☰
        </button>

        <div className="header-title">
          <h1>
            SATTU AI ASSISTANT
          </h1>
          <p>
            Your Company Knowledge
            Assistant
          </p>
        </div>

        <button
          className="icon-button"
          aria-label="Logout"
          onClick={handleLogout}
        >
          Logout
        </button>

      </header>

      {/* ASSISTANT */}

      <section className="assistant-content">

        {messages.length === 0 ? (
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
              How can I help you
              today?
            </p>

          </div>
        ) : (
          <div className="chat-messages">

            {messages.map(
              (msg, index) => (
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
              )
            )}

            {isLoading && (
              <p className="helper-text">
                Soch raha hoon...
              </p>
            )}

            {error && (
              <p
                className="helper-text"
                style={{
                  color: "red",
                }}
              >
                {error}
              </p>
            )}

            <div
              ref={messagesEndRef}
            />

          </div>
        )}

      </section>

      {/* ASK AREA */}

      <section className="ask-container">

        {messages.length > 0 && (
          <div className="chat-messages">
            {isLoading && (
              <p className="helper-text">
                {voiceLang === "hi-IN"
                  ? "Soch raha hoon..."
                  : "Thinking..."}
              </p>
            )}
          </div>
        )}

        <div className="question-box">

          <textarea
            value={question}
            onChange={(event) =>
              setQuestion(
                event.target.value
              )
            }
            onKeyDown={(event) => {
              if (
                event.key ===
                  "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();
                handleAsk();
              }
            }}
            placeholder="Ask anything..."
            rows={1}
          />

          <button
            className="lang-toggle"
            onClick={() =>
              setVoiceLang(
                voiceLang ===
                  "hi-IN"
                  ? "en-IN"
                  : "hi-IN"
              )
            }
          >
            {voiceLang === "hi-IN"
              ? "HI"
              : "EN"}
          </button>

          <button
            className={`voice-button ${
              isListening
                ? "listening"
                : ""
            }`}
            onClick={
              handleVoice
            }
            aria-label="Speak your question"
          >
            <span className="mic-icon">
              ●
            </span>
          </button>

        </div>

        <button
          className="ask-button"
          onClick={() =>
            handleAsk()
          }
          disabled={
            isLoading ||
            !question.trim()
          }
        >
          <span className="sparkle">
            ✦
          </span>

          <span>Ask</span>

          <span className="arrow">
            →
          </span>
        </button>

        <p className="helper-text">
          You can type or speak your
          question
        </p>

      </section>

    </main>
  );
}

export default App;
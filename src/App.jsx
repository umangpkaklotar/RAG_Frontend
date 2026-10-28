import { Show, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/react";
import { useEffect, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function getApiError(response, fallback) {
  try {
    const data = await response.json();
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map(item => item.msg).filter(Boolean).join("; ") || fallback;
    }
  } catch {
    return `${fallback} (HTTP ${response.status})`;
  }
  return `${fallback} (HTTP ${response.status})`;
}

export default function App() {
  return <main className="page">
    <header className="site-header"><div className="logo">D</div><div><h1>Document AI</h1><p>Ask questions. Find answers in your files.</p></div><span className="badge">RAG ASSISTANT</span>
      <Show when="signed-out"><div className="auth-actions">
        <SignInButton mode="modal"><button className="auth-button">Sign in</button></SignInButton>
        <SignUpButton mode="modal"><button className="auth-button auth-button-primary">Create account</button></SignUpButton>
      </div></Show>
      <Show when="signed-in"><UserButton /></Show>
    </header>
    <Show when="signed-out">
      <section className="signed-out card"><div className="eyebrow">YOUR DOCUMENT WORKSPACE</div><h2>Sign in to get started</h2><p>Sign in or create an account to upload documents and chat with them.</p><SignInButton mode="modal"><button className="primary">Sign in to Document AI</button></SignInButton></section>
    </Show>
    <Show when="signed-in"><DocumentWorkspace /></Show>
  </main>;
}

function DocumentWorkspace() {
  const { getToken } = useAuth();
  const welcomeMessage = {
    role: "assistant",
    text: "Welcome! Upload documents, then ask a question about their contents.",
  };
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState([welcomeMessage]);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(false);

  async function apiFetch(url, options = {}) {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    return fetch(apiUrl(url), {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
  }

  async function openConversation(id) {
    setLoadingConversation(true);
    setHistoryError("");
    try {
      const response = await apiFetch(`/api/conversations/${encodeURIComponent(id)}/messages`);
      if (!response.ok) throw new Error(await getApiError(response, "Could not open conversation"));
      const data = await response.json();
      setConversationId(id);
      setMessages((data.messages || []).map(message => ({
        role: message.role,
        text: message.content,
        sources: message.sources || [],
      })));
      setQuestion("");
    } catch (error) {
      setHistoryError(error.message);
    } finally {
      setLoadingConversation(false);
    }
  }

  async function refreshHistory(openLatest = false) {
    const response = await apiFetch("/api/conversations");
    if (!response.ok) throw new Error(await getApiError(response, "Could not load chat history"));
    const data = await response.json();
    const history = data.conversations || [];
    setConversations(history);
    if (openLatest && history.length) await openConversation(history[0].id);
    return history;
  }

  async function startNewChat() {
    setHistoryError("");
    setLoadingConversation(true);
    try {
      const response = await apiFetch("/api/conversations", { method: "POST" });
      if (!response.ok) throw new Error(await getApiError(response, "Could not create a new chat"));
      const conversation = await response.json();
      setConversationId(conversation.id);
      setMessages([welcomeMessage]);
      setQuestion("");
      await refreshHistory();
    } catch (error) {
      setHistoryError(error.message);
    } finally {
      setLoadingConversation(false);
    }
  }

  async function deleteConversation(event, id) {
    event.stopPropagation();
    if (!window.confirm("Delete this conversation and its messages? This cannot be undone.")) return;
    setHistoryError("");
    try {
      const response = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await getApiError(response, "Could not delete conversation"));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([welcomeMessage]);
        setQuestion("");
      }
      await refreshHistory();
    } catch (error) {
      setHistoryError(error.message);
    }
  }

  useEffect(() => {
    refreshHistory(true).catch(error => setHistoryError(error.message));
  }, []);

  async function upload(event) {
    event.preventDefault();
    if (!files.length) {
      setUploadStatus("Choose at least one file first.");
      return;
    }
    const form = new FormData();
    files.forEach(file => form.append("files", file));
    setUploading(true);
    setUploadStatus("Extracting text and building the search index...");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again to upload documents.");
      const response = await fetch(apiUrl("/api/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!response.ok) throw new Error(await getApiError(response, "Upload failed"));
      const data = await response.json();
      setUploadStatus(
        `Indexed ${data.sections_and_chunks_indexed} chunks from: ${data.files.join(", ")}. Total vectors: ${data.total_vectors}.`,
      );
    } catch (error) {
      setUploadStatus(`Error: ${error.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function ask(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    let activeConversationId = conversationId;
    try {
      if (!activeConversationId) {
        const createResponse = await apiFetch("/api/conversations", { method: "POST" });
        if (!createResponse.ok) {
          throw new Error(await getApiError(createResponse, "Could not create a new chat"));
        }
        const conversation = await createResponse.json();
        activeConversationId = conversation.id;
        setConversationId(activeConversationId);
        refreshHistory().catch(error => setHistoryError(error.message));
      }
    } catch (error) {
      setHistoryError(error.message);
      setAsking(false);
      return;
    }
    setMessages(old => [...old, { role: "user", text }, { role: "assistant", text: "" }]);
    setQuestion("");
    let answer = "";
    let sources = [];
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again to ask questions.");
      const response = await fetch(apiUrl("/api/ask"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: text, conversation_id: activeConversationId }),
      });
      if (!response.ok) throw new Error(await getApiError(response, "Question failed"));
      if (!response.body) throw new Error("The backend did not return an answer stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamCompleted = false;
      const handleBlock = block => {
        const line = block.split(/\r?\n/).find(item => item.startsWith("data: "));
        if (!line) return;
        const eventData = JSON.parse(line.slice(6));
        if (eventData.type === "token") {
          answer += eventData.text;
          setMessages(old => {
            const copy = [...old];
            const last = copy.length - 1;
            if (copy[last]?.role === "assistant") {
              copy[last] = { ...copy[last], text: answer };
            }
            return copy;
          });
        } else if (eventData.type === "done") {
          sources = Array.isArray(eventData.sources) ? eventData.sources : [];
          streamCompleted = true;
        } else if (eventData.type === "error") {
          throw new Error(eventData.message || "The backend could not answer the question.");
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        blocks.forEach(handleBlock);
      }
      if (buffer.trim()) handleBlock(buffer);
      if (!streamCompleted) throw new Error("The answer stream ended before it completed.");
      if (!answer.trim()) throw new Error("The AI service returned an empty answer.");
      setMessages(old => {
        const copy = [...old];
        const last = copy.length - 1;
        if (copy[last]?.role === "assistant") {
          copy[last] = { ...copy[last], text: answer, sources };
        }
        return copy;
      });
      refreshHistory().catch(error => setHistoryError(error.message));
    } catch (error) {
      setMessages(old => {
        const copy = [...old];
        const last = copy.length - 1;
        if (copy[last]?.role === "assistant") {
          copy[last] = {
            ...copy[last],
            text: answer ? `${answer}\n\nError: ${error.message}` : `Error: ${error.message}`,
            sources,
          };
        }
        return copy;
      });
    } finally {
      setAsking(false);
    }
  }

  return <>
    <section className="hero"><div className="eyebrow">YOUR DOCUMENT WORKSPACE</div><h2>Understand your documents<br/><span>with AI.</span></h2><p>Upload files, find relevant information, and get concise answers grounded in your documents.</p></section>
    <section className="layout">
      <aside className="card upload-card"><h3>Upload documents</h3>
        <button className="new-chat-button" type="button" onClick={startNewChat} disabled={asking || loadingConversation}>＋ New Chat</button>
        <p className="muted">Select one or more files to index.</p>
        <form onSubmit={upload}><label className="drop"><input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" onChange={event => setFiles(Array.from(event.target.files || []))}/><b>＋</b><strong>Choose files</strong><small>PDF, DOCX, TXT, MD, CSV</small></label>
        {files.length > 0 && <div className="file-list">{files.map(file => <div key={file.name + file.size}>▤ {file.name}</div>)}</div>}
        <button className="primary" disabled={uploading}>{uploading ? "Indexing documents…" : "Upload and index"}</button></form>
        {uploadStatus && <pre className="status-text">{uploadStatus}</pre>}<div className="tip">Scanned PDFs need OCR. The document index is kept in memory and clears when the backend restarts.</div>
        <section className="history-section">
          <h3>Chat History</h3>
          {historyError && <p className="history-error">{historyError}</p>}
          {conversations.length === 0
            ? <p className="history-empty">Your saved chats will appear here.</p>
            : <div className="history-list">{conversations.map(conversation =>
              <div className={`history-item${conversation.id === conversationId ? " active" : ""}`} key={conversation.id}>
                <button type="button" className="history-open" onClick={() => openConversation(conversation.id)} disabled={asking || loadingConversation}>
                  <span>{conversation.title}</span>
                  <small>{new Date(conversation.updated_at).toLocaleString()}</small>
                </button>
                <button type="button" className="history-delete" aria-label={`Delete ${conversation.title}`} title="Delete chat" onClick={event => deleteConversation(event, conversation.id)} disabled={asking || loadingConversation}>×</button>
              </div>
            )}</div>}
        </section>
      </aside>
      <section className="card chat-card"><div className="chat-head"><div><h3>Chat with your documents</h3><p className="muted">Answers stream live from the AI model.</p></div><span className="online">● Online</span></div>
        <div className="messages">{messages.map((message, index) => <div className={`row ${message.role}`} key={index}><div className="avatar">{message.role === "assistant" ? "D" : "Y"}</div><div className="bubble"><small>{message.role === "assistant" ? "DOCUMENT AI" : "YOU"}</small><div className="msg-text">{message.text}</div>{message.sources?.length > 0 && <div className="sources"><b>Sources</b>{message.sources.map(source => <div key={source}>• {source}</div>)}</div>}</div></div>)}{asking && <div className="thinking">Generating answer…</div>}</div>
        <form className="ask-form" onSubmit={ask}><input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask a question about your documents…"/><button disabled={asking || !question.trim()}>➤</button></form><p className="disclaimer">AI can make mistakes. Verify important information against the source.</p>
      </section>
    </section><footer>Document AI · Retrieval-Augmented Generation</footer>
  </>;
}

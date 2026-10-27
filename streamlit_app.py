import hashlib
import sys
import tempfile
from pathlib import Path

import streamlit as st

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import config
from app.rag_service import ask_stream, index_files


st.set_page_config(
    page_title="Atlas | Document Intelligence",
    page_icon="A",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    :root {
        color-scheme: dark;
        --surface: #10151e;
        --muted: #929bad;
        --accent: #a78bfa;
    }
    .stApp {
        background:
            radial-gradient(ellipse at 70% -15%, rgba(124, 93, 245, .17), transparent 38%),
            #0b0e14;
        color: #e5e7eb;
    }
    [data-testid="stSidebar"] {
        background: #0f131b;
        border-right: 1px solid rgba(255, 255, 255, .07);
    }
    [data-testid="stSidebar"] > div:first-child { padding-top: 1.5rem; }
    .block-container { max-width: 1120px; padding-top: 2.2rem; padding-bottom: 3rem; }
    .brand {
        display: flex; align-items: center; gap: 12px; margin: 0 0 2rem;
        color: #f5f3ff; font-size: 1.05rem; font-weight: 700; letter-spacing: -.02em;
    }
    .brand-mark {
        display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px;
        color: #fff; background: linear-gradient(135deg, #9b7af7, #6448cc);
        box-shadow: 0 5px 24px rgba(127, 91, 230, .32);
    }
    .eyebrow {
        color: #aa94f5; font-size: .75rem; font-weight: 700; letter-spacing: .15em;
        text-transform: uppercase; margin-bottom: .65rem;
    }
    .hero-title {
        color: #f4f3f8; font-size: clamp(2rem, 4.6vw, 3.25rem);
        font-weight: 680; letter-spacing: -.055em; line-height: 1.1; margin: 0;
    }
    .hero-copy { color: var(--muted); font-size: 1rem; margin-top: .8rem; }
    .surface-card {
        border: 1px solid rgba(255,255,255,.08); border-radius: 16px;
        background: linear-gradient(145deg, rgba(24,30,42,.92), rgba(16,20,29,.88));
        padding: 1.15rem 1.3rem; margin: 1.15rem 0;
    }
    .section-label {
        color: #e6e2f2; font-size: .87rem; font-weight: 650; margin: .2rem 0 .75rem;
    }
    .status-dot {
        display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        background: #65d6a1; box-shadow: 0 0 12px rgba(101,214,161,.55); margin-right: 7px;
    }
    .stButton > button, [data-testid="stFormSubmitButton"] > button {
        border-radius: 10px; border: 1px solid rgba(167,139,250,.35);
        background: rgba(139,110,230,.13); color: #e9e2ff;
        transition: all .18s ease;
    }
    .stButton > button:hover, [data-testid="stFormSubmitButton"] > button:hover {
        border-color: #a78bfa; background: rgba(139,110,230,.24); color: #fff;
    }
    [data-testid="stChatMessage"] {
        border: 1px solid rgba(255,255,255,.055); border-radius: 16px;
        background: rgba(20,25,35,.72); padding: 1rem 1.15rem;
    }
    [data-testid="stChatInput"] textarea { border-radius: 13px; }
    [data-testid="stFileUploader"] section {
        border-radius: 13px; border-color: rgba(255,255,255,.14);
        background: rgba(255,255,255,.018);
    }
    .stCaption, [data-testid="stCaptionContainer"] { color: #929bad; }
    hr { border-color: rgba(255,255,255,.08); }
    </style>
    """,
    unsafe_allow_html=True,
)

st.session_state.setdefault("messages", [])
st.session_state.setdefault("indexed_documents", {})


def render_sources(sources: list[str]) -> None:
    if sources:
        with st.expander(f"Sources  ·  {len(sources)}"):
            for source in sources:
                st.markdown(f"- {source}")


with st.sidebar:
    st.markdown(
        '<div class="brand"><span class="brand-mark">A</span>'
        '<span>Atlas <span style="color:#929bad;font-weight:500">/ Documents</span></span></div>',
        unsafe_allow_html=True,
    )
    st.markdown('<div class="section-label">Knowledge base</div>', unsafe_allow_html=True)
    st.caption("Add documents to your workspace and ask questions grounded in their content.")
    uploads = st.file_uploader(
        "Drop files here",
        type=sorted(extension.lstrip(".") for extension in config.SUPPORTED_EXTENSIONS),
        accept_multiple_files=True,
        help="Supported: PDF, DOCX, TXT, MD, CSV",
    )

    if st.button("Upload and Index", type="primary", use_container_width=True):
        pending = []
        for upload in uploads or []:
            content = upload.getvalue()
            digest = hashlib.sha256(content).hexdigest()
            display_name = Path(upload.name).name
            upload_key = (display_name, digest)
            if upload_key in st.session_state.indexed_documents:
                continue
            pending.append((upload, content, upload_key))

        if not pending:
            if uploads:
                st.info("These files are already indexed in this session.")
            else:
                st.warning("Choose at least one supported document first.")
        else:
            try:
                with tempfile.TemporaryDirectory() as temp_dir:
                    paths = []
                    for upload, content, _ in pending:
                        suffix = Path(upload.name).suffix.lower()
                        if suffix not in config.SUPPORTED_EXTENSIONS:
                            raise ValueError(f"Unsupported file type: {upload.name}")
                        if not content:
                            raise ValueError(f"Empty file: {upload.name}")
                        temp_path = Path(temp_dir) / f"{len(paths)}{suffix}"
                        temp_path.write_bytes(content)
                        paths.append((str(temp_path), Path(upload.name).name))

                    with st.status("Reading documents and building the search index...", expanded=True) as status:
                        result = index_files(paths)
                        status.update(
                            label=f"Indexed {len(paths)} document(s) successfully",
                            state="complete",
                            expanded=False,
                        )
                for _, _, upload_key in pending:
                    st.session_state.indexed_documents[upload_key] = upload_key[0]
                st.success(
                    f"Ready to chat. {result['sections_and_chunks_indexed']} document sections indexed."
                )
            except Exception as exc:
                st.error(f"Document indexing failed: {exc}")

    st.markdown("---")
    st.markdown('<div class="section-label">Workspace</div>', unsafe_allow_html=True)
    doc_count = len(st.session_state.indexed_documents)
    st.markdown(
        f'<span class="status-dot"></span><span style="color:#cbd2df">'
        f'{doc_count} document{"s" if doc_count != 1 else ""} indexed in this session</span>',
        unsafe_allow_html=True,
    )
    if st.session_state.indexed_documents:
        with st.expander("Indexed files"):
            for name in st.session_state.indexed_documents.values():
                st.caption(name)

    st.markdown("---")
    if st.button("Clear chat history", use_container_width=True):
        st.session_state.messages = []
        st.rerun()
    st.caption("Clearing chat keeps your indexed documents available.")


st.markdown('<div class="eyebrow">Document intelligence</div>', unsafe_allow_html=True)
st.markdown('<h1 class="hero-title">Your documents,<br>in conversation.</h1>', unsafe_allow_html=True)
st.markdown(
    '<p class="hero-copy">Ask thoughtful questions. Get clear answers grounded in your files, '
    "with sources you can verify.</p>",
    unsafe_allow_html=True,
)

if not st.session_state.messages:
    st.markdown(
        '<div class="surface-card"><span class="status-dot"></span>'
        '<strong style="color:#e9e7f0">Ready when you are</strong>'
        '<div style="color:#929bad;margin-top:7px">Upload documents from the sidebar to build your '
        "knowledge base, then start a conversation.</div></div>",
        unsafe_allow_html=True,
    )

for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])
        if message["role"] == "assistant":
            render_sources(message.get("sources", []))

question = st.chat_input("Ask a question about your documents...")
if question:
    st.session_state.messages.append({"role": "user", "content": question})
    with st.chat_message("user"):
        st.markdown(question)

    with st.chat_message("assistant"):
        try:
            sources: list[str] = []

            def stream_tokens():
                for event in ask_stream(question):
                    if event["type"] == "token":
                        yield event["text"]
                    elif event["type"] == "done":
                        sources.extend(event.get("sources", []))

            answer = st.write_stream(stream_tokens())
            render_sources(sources)
            st.session_state.messages.append(
                {"role": "assistant", "content": answer, "sources": sources}
            )
        except Exception as exc:
            st.error(f"Unable to answer this question: {exc}")

// Reconhecimento de voz real (Web Speech API) — usado somente em editar.html.
import { elements, PAGE_MODE } from "../core/state.js";
import { normalizeText } from "../core/utils.js";
import { requireAuthenticatedUser } from "../shell/auth-ui.js";

// Inicializa a Web Speech API e encaminha cada frase final para `processCommand`.
export function setupVoice() {
  if (PAGE_MODE !== "edit") return;
  if (!elements.voiceBtn) return;
  // O botao tem um icone fixo, entao o texto vai no span e nao no botao inteiro.
  const setVoiceBtnLabel = (text) => {
    const label = document.getElementById("voice-btn-label");
    if (label) label.textContent = text;
    else elements.voiceBtn.textContent = text;
  };
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (elements.voiceStatus) {
      elements.voiceStatus.textContent =
        "Navegador nao suporta reconhecimento de voz. Use Chrome ou Edge.";
    }
    setVoiceBtnLabel("Sem suporte");
    elements.voiceBtn.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = true;

  let listening = false;
  let shouldListen = false;
  let clearVoiceLastOnNextStart = false;
  const RESTART_DELAY_MS = 140;

  function setVoiceListeningUi(active) {
    if (active) {
      if (elements.voiceStatus) {
        elements.voiceStatus.textContent = "Ouvindo...";
      }
      setVoiceBtnLabel("Parar escuta");
      if (elements.voiceCard) {
        elements.voiceCard.classList.add("listening");
      }
      return;
    }

    if (elements.voiceStatus) {
      elements.voiceStatus.textContent = "Parado.";
    }
    setVoiceBtnLabel("Iniciar escuta");
    if (elements.voiceCard) {
      elements.voiceCard.classList.remove("listening");
    }
  }

  elements.voiceBtn.addEventListener("click", () => {
    if (!requireAuthenticatedUser("Faça login para iniciar a escuta por voz.")) {
      shouldListen = false;
      setVoiceListeningUi(false);
      if (elements.voiceStatus) {
        elements.voiceStatus.textContent = "Faça login para iniciar a escuta.";
      }
      return;
    }

    if (!shouldListen) {
      shouldListen = true;
      clearVoiceLastOnNextStart = true;
      if (!listening) {
        try {
          recognition.start();
        } catch (error) {
          // Ignora erro de start duplicado em navegadores mais sensiveis.
        }
      }
      return;
    }

    shouldListen = false;
    if (listening) {
      recognition.stop();
    } else {
      setVoiceListeningUi(false);
    }
  });

  recognition.onstart = () => {
    listening = true;
    if (clearVoiceLastOnNextStart && elements.voiceLast) {
      elements.voiceLast.value = "";
    }
    clearVoiceLastOnNextStart = false;
    setVoiceListeningUi(true);
  };

  recognition.onend = () => {
    listening = false;
    if (shouldListen) {
      setTimeout(() => {
        if (!shouldListen || listening) return;
        try {
          recognition.start();
        } catch (error) {
          // Ignora se o navegador ainda estiver finalizando a sessao anterior.
        }
      }, RESTART_DELAY_MS);
      return;
    }

    setVoiceListeningUi(false);
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      shouldListen = false;
      setVoiceListeningUi(false);
      setVoiceBtnLabel("Sem permissao");
      elements.voiceBtn.disabled = true;
      if (elements.voiceStatus) {
        elements.voiceStatus.textContent = "Sem permissao para usar o microfone.";
      }
      return;
    }

    if (shouldListen) {
      if (elements.voiceStatus) {
        elements.voiceStatus.textContent = "Reconectando microfone...";
      }
      return;
    }

    if (elements.voiceStatus) {
      elements.voiceStatus.textContent = `Erro: ${event.error}`;
    }
    setVoiceListeningUi(false);
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";
    const appendSpeechChunk = (current, chunk) => {
      const normalizedChunk = String(chunk || "").trim();
      if (!normalizedChunk) return current;
      if (!current) return normalizedChunk;
      return `${current} ${normalizedChunk}`;
    };

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript || "";
      if (result.isFinal) {
        finalTranscript = appendSpeechChunk(finalTranscript, text);
      } else {
        interimTranscript = appendSpeechChunk(interimTranscript, text);
      }
    }

    const normalizedFinalTranscript = normalizeText(finalTranscript);
    const normalizedInterimTranscript = normalizeText(interimTranscript);
    const displayText = (
      normalizedFinalTranscript || normalizedInterimTranscript
    ).trim();

    if (elements.voiceLast) {
      elements.voiceLast.value = displayText;
    }

    if (normalizedFinalTranscript) {
      // voice-actions.js tem ~1200 linhas de parser e so serve a quem fala com o
      // app: entra na primeira frase reconhecida, nao no boot.
      import("./voice-actions.js").then((m) =>
        m.processCommand(normalizedFinalTranscript)
      );
    }
  };
}

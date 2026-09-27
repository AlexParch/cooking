// Запись голоса в приложении: большая кнопка-микрофон → текст (OpenAI на сервере).
import { $, api, esc, haptic, state, toast } from "./ui.js";

export const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/**
 * Рисует кнопку записи в `container`. Когда запись распознана — вызывает onText(text, setStatus).
 * setStatus(html) позволяет показать следующий шаг («Оформляю рецепт…»).
 */
export function mountRecorder(container, { idle = "Нажмите и говорите", onText, small = false }) {
  if (!state.config.voice) {
    container.innerHTML = `<div class="notice">🎙 Распознавание голоса пока не подключено.</div>`;
    return;
  }
  if (!canRecord()) {
    container.innerHTML = `<div class="notice">💬 Здесь запись недоступна — отправьте, пожалуйста, <b>голосовое сообщение боту в чат</b>, я пойму так же.</div>`;
    return;
  }
  container.innerHTML = `<div class="mic-wrap ${small ? "small" : ""}"><button class="mic" type="button" aria-label="Записать">🎙</button><div class="mic-label">${esc(idle)}</div></div>`;
  const mic = $(".mic", container);
  const label = $(".mic-label", container);
  const setStatus = (html) => (label.innerHTML = html);
  let recorder = null;
  let chunks = [];
  let tick = null;

  mic.onclick = async () => {
    if (recorder?.state === "recording") return recorder.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Нет доступа к микрофону. Разрешите его или отправьте голосовое боту в чат 🙂", 5000);
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      mic.classList.remove("rec");
      mic.textContent = "🎙";
      mic.disabled = true;
      setStatus(`<span class="spinner"></span> Слушаю запись…`);
      const type = recorder.mimeType || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type }), `voice.${ext}`);
        const { text } = await api("/transcribe", { method: "POST", body: form });
        if (!text) throw new Error("Не расслышала — попробуйте ещё раз, поближе к телефону");
        await onText(text, setStatus);
        setStatus(esc(idle));
      } catch (e) {
        haptic("error");
        toast(e.message || String(e), 4500);
        setStatus("Нажмите, чтобы попробовать ещё раз");
      } finally {
        mic.disabled = false;
      }
    };
    recorder.start();
    const started = Date.now();
    mic.classList.add("rec");
    mic.textContent = "⏹";
    haptic("light");
    const show = () => {
      const s = Math.round((Date.now() - started) / 1000);
      setStatus(`🔴 Запись ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}<br><b>Нажмите ещё раз, когда закончите</b>`);
    };
    show();
    tick = setInterval(show, 500);
  };
}

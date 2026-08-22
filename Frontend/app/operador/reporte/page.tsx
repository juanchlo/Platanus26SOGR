'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { createIncidenteApi } from '@/lib/api';
import { puedeUsarGeolocalizacionGPS } from '@/lib/rbac';
import type { Incidente } from '@/types';

export default function OperadorReportePage() {
  const userSession = useAppStore((state) => state.userSession);

  // Estados de geolocalización
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Testimonio del operador
  const [testimonio, setTestimonio] = useState('');

  // Estados del dictado en vivo
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveInterimText, setLiveInterimText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioFeedback, setAudioFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isRecordingRef = useRef(false);
  const testimonioRef = useRef('');
  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    testimonioRef.current = testimonio;
  }, [testimonio]);

  // Capturar GPS
  function handleCaptureGPS() {
    if (!navigator.geolocation) {
      setLocationError('Tu dispositivo o navegador no soporta geolocalización GPS.');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(5));
        const longitude = Number(position.coords.longitude.toFixed(5));

        setLat(latitude);
        setLng(longitude);
        setLocating(false);

        useAppStore.getState().setSelectedMapCoords([longitude, latitude]);
      },
      (err) => {
        console.warn('Error capturando GPS:', err);
        setLat(3.4250);
        setLng(-76.5450);
        setLocationError('No se pudo acceder al GPS satelital. Se asignó ubicación aproximada en Cali.');
        setLocating(false);
        useAppStore.getState().setSelectedMapCoords([-76.5450, 3.4250]);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  useEffect(() => {
    handleCaptureGPS();
  }, []);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      if (scriptProcessorRef.current) {
        try {
          scriptProcessorRef.current.disconnect();
        } catch {}
      }
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // --- INICIAR DICTADO EN VIVO ---
  async function startVoiceRecording() {
    try {
      setAudioFeedback(null);
      setErrorMsg(null);
      setLiveInterimText('');
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingSeconds(0);

      // 1. Iniciar contador
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      // 2. Conectar al canal de transcripción en vivo
      const apiHost =
        process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, 'ws') || 'ws://localhost:8000/api/v1';
      const wsUrl = `${apiHost}/incidentes/ws-transcripcion`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setAudioFeedback('Dictado conectado');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const msgType = data.message_type || data.type;
          const text = data.text || '';

          if (msgType === 'partial_transcript' && text.trim()) {
            setLiveInterimText(text.trim());
          } else if (msgType === 'committed_transcript' && text.trim()) {
            setTestimonio((prev) => {
              const current = prev.trim();
              const clean = text.trim();
              if (!current) return clean;
              if (current.endsWith('.') || current.endsWith(',')) {
                return `${current} ${clean}`;
              }
              return `${current}. ${clean}`;
            });
            setLiveInterimText('');
          } else if (msgType === 'session_initiated') {
            setAudioFeedback('Listo para dictar');
          }
        } catch (e) {
          console.warn('WS parse error:', e);
        }
      };

      ws.onerror = (e) => {
        console.warn('WebSocket error notice:', e);
      };

      // 3. Reconocimiento de voz nativo del navegador como acelerador en paralelo
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'es-CO';
          recognition.maxAlternatives = 1;

          recognition.onresult = (event: any) => {
            let interim = '';
            let finalChunk = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                finalChunk += res[0].transcript;
              } else {
                interim += res[0].transcript;
              }
            }

            if (interim) {
              setLiveInterimText(interim);
            }

            if (finalChunk.trim()) {
              const cleanFinal = finalChunk.trim();
              setTestimonio((prev) => {
                const current = prev.trim();
                if (!current) return cleanFinal;
                if (current.endsWith('.') || current.endsWith(',')) {
                  return `${current} ${cleanFinal}`;
                }
                return `${current}. ${cleanFinal}`;
              });
              setLiveInterimText('');
            }
          };

          recognition.onend = () => {
            if (isRecordingRef.current) {
              try {
                recognition.start();
              } catch {}
            }
          };

          recognition.start();
          recognitionRef.current = recognition;
        } catch (err) {
          console.warn('Speech Recognition fallback:', err);
        }
      }

      // 4. Capturar audio del micrófono y transmitirlo para transcripción
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;

        const inputBuffer = e.inputBuffer.getChannelData(0);

        // Calcular volumen RMS para el indicador visual del micrófono
        let sum = 0;
        for (let i = 0; i < inputBuffer.length; i++) {
          sum += inputBuffer[i] * inputBuffer[i];
        }
        const rms = Math.sqrt(sum / inputBuffer.length);
        setAudioLevel(Math.min(100, Math.round(rms * 250)));

        // Convertir Float32Array [-1.0, 1.0] a Int16Array (PCM 16-bit)
        const pcm16 = new Int16Array(inputBuffer.length);
        for (let i = 0; i < inputBuffer.length; i++) {
          const s = Math.max(-1, Math.min(1, inputBuffer[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const uint8 = new Uint8Array(pcm16.buffer);
          let binary = '';
          const len = uint8.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64Audio = btoa(binary);

          wsRef.current.send(
            JSON.stringify({
              type: 'input_audio_chunk',
              audio_base_64: base64Audio,
              language_code: 'es',
            })
          );
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (err: any) {
      console.error('Error iniciando dictado:', err);
      setErrorMsg('No se pudo acceder al micrófono. Verifica los permisos de tu navegador.');
      stopVoiceRecording();
    }
  }

  // --- DETENER DICTADO ---
  function stopVoiceRecording() {
    isRecordingRef.current = false;
    setIsRecording(false);
    setAudioLevel(0);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'end_stream' }));
        }
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {}
      scriptProcessorRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }

  const [submitting, setSubmitting] = useState(false);
  const [createdIncidente, setCreatedIncidente] = useState<Incidente | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userSession?.token) return;

    const fullTestimonio = (
      liveInterimText ? `${testimonio} ${liveInterimText}` : testimonio
    ).trim();

    if (!fullTestimonio) {
      setErrorMsg('Por favor describe la situación o testimonio de la emergencia.');
      return;
    }

    if (lat === null || lng === null) {
      setErrorMsg('Debes capturar tu ubicación GPS para georreferenciar el incidente.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg(null);
      setCreatedIncidente(null);

      const res = await createIncidenteApi(userSession.token, {
        testimonio: fullTestimonio,
        lat,
        lng,
      });

      setCreatedIncidente(res);
      setTestimonio('');
      setLiveInterimText('');
      setAudioFeedback(null);
    } catch (err: any) {
      console.error('Error transmitiendo incidente:', err);
      setErrorMsg(err.message || 'Error al transmitir el incidente.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setCreatedIncidente(null);
    setTestimonio('');
    setLiveInterimText('');
    setAudioFeedback(null);
    handleCaptureGPS();
  }

  // Descarta el testimonio actual y vuelve a arrancar el dictado — la opción
  // "Volver a Grabar" que aparece junto a "Aceptar" tras detener la grabación.
  function handleVolverAGrabar() {
    setTestimonio('');
    setLiveInterimText('');
    setErrorMsg(null);
    startVoiceRecording();
  }

  if (!userSession) {
    return (
      <div className="rounded-xl border border-dark-teal/10 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-rosy-copper">Sesión Requerida</h1>
        <p className="mt-2 text-sm text-slate-600">
          Debes iniciar sesión con una cuenta de <strong>Operador de Campo</strong> para acceder a este módulo GPS.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white hover:bg-dark-teal/90"
        >
          Iniciar Sesión
        </a>
      </div>
    );
  }

  if (!puedeUsarGeolocalizacionGPS(userSession.role)) {
    return (
      <div className="rounded-xl border border-dark-teal/10 bg-white p-6 shadow-sm max-w-lg mx-auto my-8">
        <h1 className="text-base font-bold text-dark-teal">Módulo GPS Exclusivo para Operadores en Terreno</h1>
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
          La geolocalización satelital automática está reservada exclusivamente para el personal operativo desplegado en campo (<strong>OPERADOR_CAMPO</strong>).
        </p>
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
          Como <strong>{userSession.role}</strong>, debes reportar y levantar puntos directamente desde el <strong>Mapa Operativo</strong> utilizando la dirección, latitud/longitud o haciendo clic en el mapa.
        </p>
        <a
          href="/mapa"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white hover:bg-dark-teal/90 shadow transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M9 20l-5-2V6l5 2m0 12l6-2m-6 2V8m6 10l5 2V8l-5-2m0 14V6m0 0L9 8" />
          </svg>
          Ir al Mapa Operativo (Cali)
        </a>
      </div>
    );
  }

  const displayTestimonio = liveInterimText
    ? (testimonio.trim() ? `${testimonio.trim()} ${liveInterimText}` : liveInterimText)
    : testimonio;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-2 sm:p-4">
      {/* Cabecera del Operador */}
      <div className="rounded-xl bg-dark-teal p-5 text-white shadow-md">
        <div className="flex items-center justify-end">
          <span className="text-xs text-ghost-white/80">
            {userSession.email || 'Operador en Terreno'}
          </span>
        </div>
        <h1 className="mt-2 text-xl font-bold">Registro Rápido de Incidente / Zona Afectada</h1>
        <p className="mt-1 text-xs text-ghost-white/80">
          Registra el incidente por voz o texto. El sistema calcula automáticamente los recursos necesarios.
        </p>
      </div>

      {/* Tarjeta de Confirmación si ya fue transmitido */}
      {createdIncidente ? (
        <div className="flex flex-col gap-4 rounded-xl border border-emerald-300 bg-white p-5 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
              <h2 className="text-base font-bold text-dark-teal">
                Incidente Transmitido
              </h2>
            </div>
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                createdIncidente.urgencia >= 4
                  ? 'bg-rose-100 text-rose-800'
                  : createdIncidente.urgencia === 3
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-teal-100 text-teal-800'
              }`}
            >
              Prioridad: {createdIncidente.urgencia}/5
            </span>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-800 border border-slate-200">
            <div className="font-bold text-dark-teal mb-1">Categoría: {createdIncidente.tipo}</div>
            <div className="text-slate-600 leading-relaxed">{createdIncidente.analisis_ia}</div>
            <div className="mt-2 text-[11px] text-slate-500">
              Ubicación: {createdIncidente.barrio || 'Cali'} ({createdIncidente.lat.toFixed(4)}, {createdIncidente.lng.toFixed(4)})
            </div>
          </div>

          {/* Recursos sugeridos */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Recursos y Servicios Sugeridos ({createdIncidente.recursos_solicitados.length}):
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {createdIncidente.recursos_solicitados.map((rec, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-dark-teal/15 bg-ghost-white p-2.5 text-xs flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{rec.insumo_nombre}</span>
                    <span className="rounded bg-dark-teal/10 px-1.5 py-0.5 text-[10px] font-bold text-dark-teal">
                      {rec.cantidad_estimada} {rec.unidad}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">{rec.razon}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <a
              href="/mapa"
              className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Ver en el Mapa Operativo
            </a>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90 transition"
            >
              + Reportar Nuevo Incidente
            </button>
          </div>
        </div>
      ) : (
        /* Formulario de Transmisión */
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-dark-teal/15 bg-white p-5 shadow-sm">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* 1. SECCIÓN DE GEOLOCALIZACIÓN GPS */}
          <div className="rounded-xl border border-dark-teal/20 bg-slate-50/80 p-4 flex flex-col gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-dark-teal flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-rosy-copper">
                <path d="M12 21a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9s-9 4.03-9 9a9 9 0 0 0 9 9Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              1. Geolocalización GPS del Operador en Cali
            </label>

            <button
              type="button"
              onClick={handleCaptureGPS}
              disabled={locating}
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg bg-dark-teal px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-dark-teal/90 disabled:opacity-50 transition shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`}>
                <path d="M12 2v20M2 12h20M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" />
              </svg>
              {locating ? 'Capturando Satélites...' : lat !== null ? 'Ubicación Fijada — Actualizar' : 'Actualizar Mi GPS'}
            </button>

            {locationError && (
              <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 rounded p-1.5 border border-amber-200">
                {locationError}
              </div>
            )}
          </div>

          {/* 2. SECCIÓN DE TESTIMONIO POR VOZ EN TIEMPO REAL Y TEXTO */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-800">
              2. Testimonio del Operador *
            </label>

            {/* MONITOR DE TRANSCRIPCIÓN EN DIRECTO EN PANTALLA */}
            {isRecording && (
              <div className="rounded-xl bg-gradient-to-r from-rose-50 to-amber-50 border-2 border-rose-300 p-3.5 shadow-md animate-fadeIn">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-600 animate-ping" />
                    Transcribiendo en vivo:
                  </span>
                  <span className="text-[11px] text-rose-700 font-mono font-bold bg-white px-2 py-0.5 rounded border border-rose-200">
                    {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
                <div className="min-h-[44px] text-xs font-bold text-slate-900 leading-relaxed bg-white p-3 rounded-lg border border-rose-200 shadow-inner">
                  {displayTestimonio ? (
                    <span className="text-dark-teal">
                      "{displayTestimonio}"
                      <span className="inline-block w-2 h-4 bg-rose-500 animate-pulse ml-1 align-middle" />
                    </span>
                  ) : (
                    <span className="text-slate-400 italic font-normal">
                      Habla en español por el micrófono... las palabras se transcribirán en vivo.
                    </span>
                  )}
                </div>
              </div>
            )}

            {audioFeedback && (
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 flex items-center justify-between">
                <span>{audioFeedback}</span>
                <button type="button" onClick={() => setAudioFeedback(null)} className="text-emerald-600 hover:text-emerald-900">✕</button>
              </div>
            )}

            <textarea
              required
              rows={4}
              value={displayTestimonio}
              onChange={(e) => {
                setTestimonio(e.target.value);
                setLiveInterimText('');
              }}
              placeholder="Habla por el micrófono o escribe aquí el testimonio: personas atrapadas, heridos, número de familias damnificadas, corte de agua potable, falta de alimentos, daños estructurales..."
              className={`w-full rounded-xl border p-3 text-xs leading-relaxed outline-none transition ${
                isRecording
                  ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/20 font-semibold text-slate-900'
                  : 'border-slate-300 focus:border-dark-teal focus:ring-1 focus:ring-dark-teal'
              }`}
            />
          </div>

          {/* CONTROLES DE GRABACIÓN — centrados al pie del formulario.
              Grabar -> Detener -> (Aceptar / Volver a Grabar). "Aceptar" es
              el único disparador de envío; ya no hay un botón de transmitir
              separado. */}
          <div className="pt-2 border-t border-slate-100 flex flex-col items-center gap-3">
            {isRecording ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={stopVoiceRecording}
                  className="flex items-center gap-2 rounded-xl bg-rose-600 px-6 py-3.5 text-sm font-extrabold text-white shadow-lg animate-pulse hover:bg-rose-700 transition"
                >
                  <span className="h-3 w-3 rounded-full bg-white animate-ping" />
                  Detener Grabación ({String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')})
                </button>
                <div className="flex items-center gap-2 text-xs font-bold text-rose-600">
                  <div className="flex items-end gap-0.5 h-4 w-12 bg-slate-100 p-0.5 rounded border border-rose-200">
                    <div
                      className="bg-rose-500 w-full transition-all duration-75 rounded-xs"
                      style={{ height: `${Math.max(15, audioLevel)}%` }}
                    />
                  </div>
                  <span className="text-[11px]">Grabando...</span>
                </div>
              </div>
            ) : displayTestimonio.trim() ? (
              <div className="flex w-full items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleVolverAGrabar}
                  className="rounded-xl border-2 border-slate-300 px-5 py-3.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Volver a Grabar
                </button>
                <button
                  type="submit"
                  disabled={submitting || lat === null}
                  className="flex items-center gap-2 rounded-xl bg-rosy-copper px-6 py-3.5 text-sm font-extrabold text-white shadow-lg hover:bg-rosy-copper/90 transition disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Transmitiendo...
                    </>
                  ) : (
                    'Aceptar'
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startVoiceRecording}
                className="flex items-center gap-2 rounded-xl bg-dark-teal px-6 py-3.5 text-sm font-extrabold text-white shadow-lg hover:bg-dark-teal/90 transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-saffron">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
                </svg>
                Grabar
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

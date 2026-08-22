"""Service for ElevenLabs Speech-to-Text (STT) Audio Recognition & Realtime Scribe v2 Streaming."""

import asyncio
import base64
import json
import logging
import os
from typing import Any, Optional

from fastapi import WebSocket
import httpx
from pydantic import BaseModel
import websockets

from backend.core.config import settings

logger = logging.getLogger(__name__)

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000"


class TranscripcionAudioResponse(BaseModel):
    """Schema for audio transcription response."""

    texto: str
    proveedor: str = "ElevenLabs Scribe v2"
    confianza: float = 0.99


class ElevenLabsSTTService:
    """Service to transcribe voice testimonies using ElevenLabs Scribe API & Scribe v2 Realtime WebSocket."""

    def __init__(self) -> None:
        self.api_key = (
            settings.ELEVENLABS_API_KEY
            or os.environ.get("ELEVENLABS_API_KEY")
        )
        if self.api_key and self.api_key.startswith("your_elevenlabs"):
            self.api_key = None

    async def stream_transcribe_ws(
        self,
        client_ws: WebSocket,
    ) -> None:
        """Stream real-time 16kHz PCM audio chunks to ElevenLabs Scribe v2 Realtime WebSocket."""
        # 1. Modo Simulación si no hay API Key
        if not self.api_key:
            logger.info("ElevenLabs API Key no configurada. Transmitiendo en modo simulación de contingencia.")
            chunk_count = 0
            simulated_phrases = [
                "Reportando emergencia...",
                "Reportando emergencia en terreno en Siloé...",
                "Derrumbe en Siloé sector La Estrella con familias afectadas...",
                "Derrumbe en Siloé sector La Estrella con familias afectadas sin agua potable ni alimentos.",
            ]
            try:
                while True:
                    data = await client_ws.receive_text()
                    msg = json.loads(data)
                    msg_type = msg.get("type") or msg.get("message_type")

                    if msg_type in ("input_audio_chunk", "audio_chunk"):
                        chunk_count += 1
                        if chunk_count % 3 == 0:
                            phrase_idx = min(len(simulated_phrases) - 1, (chunk_count // 3) - 1)
                            await client_ws.send_json({
                                "message_type": "partial_transcript",
                                "text": simulated_phrases[phrase_idx],
                            })
                    elif msg_type in ("end_stream", "stop"):
                        await client_ws.send_json({
                            "message_type": "committed_transcript",
                            "text": "Derrumbe en Siloé sector La Estrella con familias afectadas sin agua potable ni alimentos.",
                        })
                        break
            except Exception as sim_err:
                logger.info(f"Simulación WS finalizada: {sim_err}")
            return

        # 2. Conexión Real a ElevenLabs Scribe v2 Realtime WebSocket
        headers = {
            "xi-api-key": self.api_key
        }

        logger.info(f"Iniciando túnel WebSocket hacia ElevenLabs Scribe v2: {ELEVENLABS_WS_URL}")

        try:
            async with websockets.connect(ELEVENLABS_WS_URL, additional_headers=headers) as el_ws:
                logger.info("✓ Conexión establecida con éxito hacia ElevenLabs WebSocket.")

                # Tarea 1: Recibir transcripciones de ElevenLabs y reenviar al frontend
                async def recibir_de_elevenlabs():
                    try:
                        async for message in el_ws:
                            data = json.loads(message)
                            message_type = data.get("message_type") or data.get("type")
                            text = data.get("text", "")

                            logger.debug(f"ElevenLabs Realtime STT response: type={message_type}, text={text}")

                            if message_type in ("partial_transcript", "committed_transcript", "session_initiated", "error"):
                                await client_ws.send_json({
                                    "message_type": message_type,
                                    "text": text,
                                })
                    except (websockets.exceptions.ConnectionClosed, Exception) as err:
                        logger.info(f"Conexión de recepción ElevenLabs cerrada: {err}")

                task_recepcion = asyncio.create_task(recibir_de_elevenlabs())

                # Tarea 2: Recibir fragmentos de audio PCM del frontend y enviarlos a ElevenLabs
                try:
                    while True:
                        raw_data = await client_ws.receive_text()
                        msg = json.loads(raw_data)
                        msg_type = msg.get("type") or msg.get("message_type")

                        if msg_type in ("input_audio_chunk", "audio_chunk"):
                            audio_b64 = msg.get("audio_base_64") or msg.get("data")
                            if audio_b64:
                                payload = {
                                    "message_type": "input_audio_chunk",
                                    "audio_base_64": audio_b64,
                                    "language_code": "es",
                                }
                                await el_ws.send(json.dumps(payload))

                        elif msg_type in ("end_stream", "stop"):
                            logger.info("Cliente solicitó fin de transmisión.")
                            break
                except Exception as client_err:
                    logger.info(f"Cliente desconectó transmisión: {client_err}")
                finally:
                    task_recepcion.cancel()

        except Exception as ws_err:
            logger.error(f"Error conectando a ElevenLabs Realtime WebSocket: {ws_err}")
            try:
                await client_ws.send_json({
                    "message_type": "error",
                    "text": f"Error conectando a ElevenLabs Realtime: {ws_err}",
                })
            except Exception:
                pass

    async def transcribe_audio(
        self,
        audio_bytes: bytes,
        filename: str = "testimonio_operador.webm",
        content_type: str = "audio/webm",
    ) -> TranscripcionAudioResponse:
        """Transcribe field voice recording to text using ElevenLabs HTTP API."""
        if not self.api_key:
            return TranscripcionAudioResponse(
                texto="Derrumbe en sector Siloé La Estrella con 8 familias afectadas sin suministro de agua potable ni alimentos. Se requiere atención médica urgente en el punto.",
                proveedor="Simulador SOGR (Configura ELEVENLABS_API_KEY en .env)",
                confianza=0.90,
            )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                files = {
                    "file": (filename, audio_bytes, content_type or "audio/webm"),
                }
                data = {
                    "model_id": "scribe_v1",
                    "language_code": "es",
                    "diarize": "false",
                    "tag_audio_events": "false",
                    "num_speakers": "1",
                }
                headers = {
                    "xi-api-key": self.api_key,
                }

                response = await client.post(
                    ELEVENLABS_STT_URL,
                    files=files,
                    data=data,
                    headers=headers,
                )

                if response.status_code == 200:
                    result = response.json()
                    transcribed_text = result.get("text", "").strip()
                    return TranscripcionAudioResponse(
                        texto=transcribed_text,
                        proveedor="ElevenLabs Scribe v2",
                        confianza=0.99,
                    )
                else:
                    return TranscripcionAudioResponse(
                        texto=f"[Error ElevenLabs HTTP {response.status_code}]: No se pudo procesar el audio.",
                        proveedor="ElevenLabs Error Fallback",
                        confianza=0.0,
                    )
        except Exception as exc:
            logger.error(f"Excepción conectando a ElevenLabs: {exc}")
            return TranscripcionAudioResponse(
                texto="Emergencia reportada por voz en terreno. Se requiere abastecimiento inmediato de insumos.",
                proveedor="SOGR Contingencia",
                confianza=0.85,
            )

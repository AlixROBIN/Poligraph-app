"""
streaming/consumer.py — Consomme le topic "features" pour FastAPI.

Usage dans api.py :
    from streaming.consumer import FeatureConsumer
    consumer = FeatureConsumer()
    consumer.start()
    articles = consumer.latest(n=20)
"""

import json
import logging
import os
import threading
from collections import deque

from kafka import KafkaConsumer
from kafka.errors import NoBrokersAvailable

log = logging.getLogger(__name__)

BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TOPIC             = "features"
MAX_BUFFER        = int(os.getenv("FEATURES_BUFFER_SIZE", "500"))


class FeatureConsumer:
    """Consomme un topic Kafka en background, expose les N derniers messages."""

    def __init__(self, bootstrap_servers: str = BOOTSTRAP_SERVERS, topic: str = TOPIC):
        self._buffer: deque[dict]    = deque(maxlen=MAX_BUFFER)
        self._servers                = bootstrap_servers
        self._topic                  = topic
        self._thread: threading.Thread | None = None
        self._running                = False

    # ── API publique ──────────────────────────────────────────────────────

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread  = threading.Thread(target=self._consume, daemon=True, name="kafka-consumer")
        self._thread.start()
        log.info(f"FeatureConsumer démarré → {self._servers} / topic='{TOPIC}'")

    def stop(self):
        self._running = False

    def latest(self, n: int = 50) -> list[dict]:
        return list(self._buffer)[-n:]

    def dump_snapshot(self, path: str):
        """Écrit le buffer courant en Parquet (pour predict.py --live-sentiment)."""
        import pandas as pd
        from pathlib import Path
        rows = list(self._buffer)
        if not rows:
            return
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            pd.DataFrame(rows).to_parquet(path, index=False)
            log.debug(f"Snapshot écrit : {path} ({len(rows)} articles)")
        except Exception as exc:
            log.warning(f"dump_snapshot échoué : {exc}")

    @property
    def is_running(self) -> bool:
        return self._running

    # ── Thread interne ────────────────────────────────────────────────────

    def _consume(self):
        try:
            consumer = KafkaConsumer(
                self._topic,
                bootstrap_servers=self._servers,
                value_deserializer=lambda b: json.loads(b.decode("utf-8")),
                auto_offset_reset="earliest",
                group_id=None,
                consumer_timeout_ms=1_000,
            )
            log.info("FeatureConsumer connecté à Kafka")
            while self._running:
                for msg in consumer:
                    self._buffer.append(msg.value)
                    if not self._running:
                        break
            consumer.close()
        except NoBrokersAvailable:
            log.warning("FeatureConsumer: Kafka indisponible — le streaming sera désactivé")
            self._running = False
        except Exception as exc:
            log.error(f"FeatureConsumer: {exc}")
            self._running = False

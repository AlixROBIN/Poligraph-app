"""
streaming/producer.py — Scraper RSS/Reddit → Kafka topic "raw-articles"

Sources:
  - RSS presse française (Le Monde, Le Figaro, France Info, Libération, Le Point)
  - Reddit r/france, r/politique (optionnel via PRAW — configure REDDIT_CLIENT_ID/SECRET)

Usage:
  python -m streaming.producer
  SCRAPE_INTERVAL=60 python -m streaming.producer
"""

import hashlib
import json
import logging
import os
import sys
import time
from collections import OrderedDict
from datetime import datetime, timezone

import feedparser
import requests as _req
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
# Supprime les logs verbeux de kafka-python (BrokerConnection, etc.)
logging.getLogger("kafka").setLevel(logging.WARNING)
log = logging.getLogger(__name__)

BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS")
TOPIC             = "raw-articles"
SCRAPE_INTERVAL   = int(os.getenv("SCRAPE_INTERVAL", "300"))

RSS_FEEDS = [
    ("lemonde",    "https://www.lemonde.fr/politique/rss_full.xml"),
    ("lefigaro",   "https://www.lefigaro.fr/rss/figaro_politique.xml"),
    ("liberation", "https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml"),
    ("franceinfo", "https://www.francetvinfo.fr/politique.rss"),
    ("lepoint",    "https://www.lepoint.fr/politique/rss.xml"),
]

REDDIT_FEEDS = [
    ("reddit/r/france",    "https://www.reddit.com/r/france/hot/.rss?limit=25"),
    ("reddit/r/politique", "https://www.reddit.com/r/politique/hot/.rss?limit=25"),
]

_UA = "MonAppPolitique/1.0 (https://github.com/poligraph; data engineering portfolio)"


def article_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def build_producer() -> KafkaProducer:
    for attempt in range(3):
        try:
            producer = KafkaProducer(
                bootstrap_servers=BOOTSTRAP_SERVERS,
                value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
                acks="all",
                retries=3,
                max_block_ms=10_000,
            )
            log.info(f"Kafka producer connecté à {BOOTSTRAP_SERVERS}")
            return producer
        except NoBrokersAvailable:
            wait = 2 ** attempt
            log.warning(f"Kafka non disponible, retry dans {wait}s…")
            time.sleep(wait)
    raise RuntimeError(f"Impossible de se connecter à Kafka ({BOOTSTRAP_SERVERS})")


def _fetch_feed(url: str) -> feedparser.FeedParserDict:
    """Récupère un flux RSS/Atom avec User-Agent correct (Reddit exige en-tête non-vide)."""
    try:
        resp = _req.get(url, headers={"User-Agent": _UA}, timeout=15)
        resp.raise_for_status()
        return feedparser.parse(resp.content)
    except Exception:
        return feedparser.parse(url)   # fallback sans header


def scrape_rss(source: str, url: str) -> list[dict]:
    articles = []
    try:
        feed = _fetch_feed(url)
        for entry in feed.entries:
            link = entry.get("link") or entry.get("id") or ""
            raw_text = ""
            if "content" in entry and entry.content:
                raw_text = entry.content[0].get("value", "")

            article = {
                "id":           article_id(link),
                "title":        entry.get("title", ""),
                "description":  entry.get("summary", ""),
                "source":       source,
                "url":          link,
                "published_at": entry.get("published", datetime.now(timezone.utc).isoformat()),
                "raw_text":     raw_text,
                "scraped_at":   datetime.now(timezone.utc).isoformat(),
            }
            articles.append(article)
        log.info(f"[{source}] {len(articles)} articles récupérés")
    except Exception as exc:
        log.error(f"[{source}] Erreur RSS: {exc}")
    return articles


def scrape_reddit_rss() -> list[dict]:
    """Scrape Reddit via flux RSS public — aucune clé API requise."""
    articles = []
    for source, url in REDDIT_FEEDS:
        try:
            feed = _fetch_feed(url)
            for entry in feed.entries:
                link = entry.get("link") or entry.get("id") or ""
                title   = entry.get("title", "")
                summary = entry.get("summary", "")
                article = {
                    "id":           article_id(link),
                    "title":        title,
                    "description":  summary[:500],
                    "source":       source,
                    "url":          link,
                    "published_at": entry.get("published", datetime.now(timezone.utc).isoformat()),
                    "raw_text":     summary,
                    "scraped_at":   datetime.now(timezone.utc).isoformat(),
                }
                articles.append(article)
            log.info(f"[{source}] {len(feed.entries)} posts récupérés")
        except Exception as exc:
            log.error(f"[{source}] Erreur Reddit RSS: {exc}")
    return articles


def run():
    if not BOOTSTRAP_SERVERS:
        log.info("KAFKA_BOOTSTRAP_SERVERS non défini — mode sans Kafka, producer inutile (l'API scrappe les RSS directement).")
        sys.exit(0)
    producer  = build_producer()
    seen_ids: OrderedDict[str, None] = OrderedDict()

    log.info(f"Scraping toutes les {SCRAPE_INTERVAL}s → topic '{TOPIC}'")

    while True:
        new = 0
        all_articles = []
        for source, url in RSS_FEEDS:
            all_articles.extend(scrape_rss(source, url))
        all_articles.extend(scrape_reddit_rss())

        for article in all_articles:
            if article["id"] not in seen_ids:
                producer.send(TOPIC, value=article)
                seen_ids[article["id"]] = None
                new += 1
                if len(seen_ids) > 10_000:
                    seen_ids.popitem(last=False)

        producer.flush()
        log.info(f"Cycle terminé — {new} nouveaux articles envoyés")

        time.sleep(SCRAPE_INTERVAL)


if __name__ == "__main__":
    run()

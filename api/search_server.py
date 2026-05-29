#!/usr/bin/env python3
"""
Standalone podcast search server for British Radio Player.

This wraps the Cloud Function search logic as a standalone Flask server,
enabling self-hosted deployment on a Raspberry Pi without GCP dependencies.

The server loads the podcast index from the local filesystem (not GCS)
and serves search queries to the Android app.

Endpoints
---------
GET /search/podcasts?q=QUERY[&limit=50]
    Full-text search over podcast titles and descriptions.

GET /search/episodes?q=QUERY[&limit=100][&offset=0]
    Full-text search over episode titles and descriptions.

GET /index/status
    Returns podcast_count, episode_count and generated_at.

POST /summarize
    Returns a short summary for episode/podcast share text.

GET /health
    Health check endpoint.

Usage:
    python3 search_server.py

Environment variables:
    BBC_RADIO_DATA_DIR — Path to directory containing podcast-index.json.gz
                         (default: /home/shaivure/bbc-radio/data)
"""
import os
import sys

# Set local mode before importing cloud function so it loads from filesystem
DATA_DIR = os.environ.get('BBC_RADIO_DATA_DIR', '/home/shaivure/bbc-radio/data')
os.environ['GCS_BUCKET'] = '__local__'
os.environ['INDEX_OBJECT'] = os.path.join(DATA_DIR, 'podcast-index.json.gz')

# Add parent directory to path so cloud_function module can be imported
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, request, jsonify
from cloud_function.main import search as cf_search

app = Flask(__name__)


@app.route('/search/podcasts', methods=['GET'])
def search_podcasts():
    return cf_search(request)


@app.route('/search/episodes', methods=['GET'])
def search_episodes():
    return cf_search(request)


@app.route('/index/status', methods=['GET'])
def index_status():
    return cf_search(request)


@app.route('/summarize', methods=['POST'])
def summarize():
    return cf_search(request)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001)

# config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-key-change-in-production'
    TRACCAR_SERVER = os.environ.get('TRACCAR_SERVER') or 'http://localhost:8082'
    TRACCAR_USERNAME = os.environ.get('TRACCAR_USERNAME') or ''
    TRACCAR_PASSWORD = os.environ.get('TRACCAR_PASSWORD') or ''
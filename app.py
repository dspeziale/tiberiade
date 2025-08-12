import requests
import json
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from datetime import datetime, timedelta
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'your-secret-key-here')

# Configurazione Traccar
TRACCAR_SERVER = os.environ.get('TRACCAR_SERVER', 'http://localhost:8082')
TRACCAR_USERNAME = os.environ.get('TRACCAR_USERNAME', '')
TRACCAR_PASSWORD = os.environ.get('TRACCAR_PASSWORD', '')


class TraccarAPI:
    def __init__(self, server_url, username=None, password=None):
        self.server_url = server_url.rstrip('/')
        self.session = requests.Session()
        if username and password:
            self.login(username, password)

    def login(self, username, password):
        """Autentica con il server Traccar"""
        try:
            response = self.session.post(
                f"{self.server_url}/api/session",
                data={
                    'email': username,
                    'password': password
                }
            )
            if response.status_code == 200:
                return True
            return False
        except Exception as e:
            print(f"Errore login: {e}")
            return False

    def get_devices(self):
        """Ottiene tutti i dispositivi"""
        try:
            response = self.session.get(f"{self.server_url}/api/devices")
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            print(f"Errore nel recuperare i dispositivi: {e}")
            return []

    def get_positions(self, device_id=None, from_time=None, to_time=None):
        """Ottiene le posizioni dei dispositivi"""
        try:
            params = {}
            if device_id:
                params['deviceId'] = device_id
            if from_time:
                params['from'] = from_time.isoformat() + 'Z'
            if to_time:
                params['to'] = to_time.isoformat() + 'Z'

            response = self.session.get(f"{self.server_url}/api/positions", params=params)
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            print(f"Errore nel recuperare le posizioni: {e}")
            return []

    def get_device_status(self, device_id):
        """Ottiene lo status di un dispositivo specifico"""
        try:
            response = self.session.get(f"{self.server_url}/api/positions",
                                        params={'deviceId': device_id})
            if response.status_code == 200:
                positions = response.json()
                return positions[0] if positions else None
            return None
        except Exception as e:
            print(f"Errore nel recuperare lo status del dispositivo: {e}")
            return None

    def get_reports_route(self, device_ids, from_time, to_time):
        """Ottiene il report delle rotte"""
        try:
            params = {
                'deviceId': device_ids,
                'from': from_time.isoformat() + 'Z',
                'to': to_time.isoformat() + 'Z'
            }
            response = self.session.get(f"{self.server_url}/api/reports/route", params=params)
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            print(f"Errore nel recuperare il report delle rotte: {e}")
            return []


# Inizializza l'API Traccar
traccar_api = TraccarAPI(TRACCAR_SERVER)


@app.route('/')
def index():
    """Dashboard principale"""
    return render_template('dashboard.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    """Pagina di login"""
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        if traccar_api.login(username, password):
            session['logged_in'] = True
            session['username'] = username
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error='Credenziali non valide')

    return render_template('login.html')


@app.route('/logout')
def logout():
    """Logout"""
    session.clear()
    return redirect(url_for('login'))


@app.route('/dashboard')
def dashboard():
    """Dashboard con lista dispositivi"""
    if not session.get('logged_in'):
        return redirect(url_for('login'))

    devices = traccar_api.get_devices()
    return render_template('dashboard.html', devices=devices)


@app.route('/api/devices')
def api_devices():
    """API per ottenere i dispositivi"""
    devices = traccar_api.get_devices()
    return jsonify(devices)


@app.route('/api/positions')
def api_positions():
    """API per ottenere le posizioni"""
    device_id = request.args.get('deviceId')
    hours = int(request.args.get('hours', 24))

    to_time = datetime.utcnow()
    from_time = to_time - timedelta(hours=hours)

    positions = traccar_api.get_positions(device_id, from_time, to_time)
    return jsonify(positions)


@app.route('/api/device/<int:device_id>/status')
def api_device_status(device_id):
    """API per ottenere lo status di un dispositivo"""
    status = traccar_api.get_device_status(device_id)
    return jsonify(status)


@app.route('/device/<int:device_id>')
def device_detail(device_id):
    """Pagina dettaglio dispositivo"""
    if not session.get('logged_in'):
        return redirect(url_for('login'))

    devices = traccar_api.get_devices()
    device = next((d for d in devices if d['id'] == device_id), None)

    if not device:
        return "Dispositivo non trovato", 404

    return render_template('device_detail.html', device=device)


@app.route('/map')
def map_view():
    """Visualizzazione mappa"""
    if not session.get('logged_in'):
        return redirect(url_for('login'))

    return render_template('map.html')


@app.route('/reports')
def reports():
    """Pagina reports"""
    if not session.get('logged_in'):
        return redirect(url_for('login'))

    return render_template('reports.html')


@app.route('/api/reports/route')
def api_reports_route():
    """API per i report delle rotte"""
    device_ids = request.args.getlist('deviceId')
    days = int(request.args.get('days', 1))

    to_time = datetime.utcnow()
    from_time = to_time - timedelta(days=days)

    reports = []
    for device_id in device_ids:
        report = traccar_api.get_reports_route([device_id], from_time, to_time)
        reports.extend(report)

    return jsonify(reports)


if __name__ == '__main__':
    # Autentica automaticamente se le credenziali sono fornite
    if TRACCAR_USERNAME and TRACCAR_PASSWORD:
        if traccar_api.login(TRACCAR_USERNAME, TRACCAR_PASSWORD):
            print("✓ Autenticazione con Traccar riuscita")
        else:
            print("✗ Errore nell'autenticazione con Traccar")

    app.run(debug=True, host='0.0.0.0', port=5000)
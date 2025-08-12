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

    def create_device(self, device_data):
        """Crea un nuovo dispositivo"""
        try:
            response = self.session.post(
                f"{self.server_url}/api/devices",
                headers={'Content-Type': 'application/json'},
                json=device_data
            )
            if response.status_code == 200:
                return {'success': True, 'data': response.json()}
            else:
                error_msg = response.text if response.text else f"Errore HTTP {response.status_code}"
                return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def update_device(self, device_id, device_data):
        """Aggiorna un dispositivo esistente"""
        try:
            response = self.session.put(
                f"{self.server_url}/api/devices/{device_id}",
                headers={'Content-Type': 'application/json'},
                json=device_data
            )
            if response.status_code == 200:
                return {'success': True, 'data': response.json()}
            else:
                error_msg = response.text if response.text else f"Errore HTTP {response.status_code}"
                return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def delete_device(self, device_id):
        """Elimina un dispositivo"""
        try:
            response = self.session.delete(f"{self.server_url}/api/devices/{device_id}")
            if response.status_code == 204:
                return {'success': True}
            else:
                error_msg = response.text if response.text else f"Errore HTTP {response.status_code}"
                return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_device_by_id(self, device_id):
        """Ottiene un dispositivo specifico per ID"""
        try:
            devices = self.get_devices()
            for device in devices:
                if device['id'] == int(device_id):
                    return device
            return None
        except Exception as e:
            print(f"Errore nel recuperare il dispositivo {device_id}: {e}")
            return None

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


@app.route('/devices')
def devices_management():
    """Pagina gestione dispositivi"""
    if not session.get('logged_in'):
        return redirect(url_for('login'))

    return render_template('devices_management.html')


# API Routes
@app.route('/api/devices', methods=['GET'])
def api_devices():
    """API per ottenere i dispositivi"""
    devices = traccar_api.get_devices()
    return jsonify(devices)


@app.route('/api/devices', methods=['POST'])
def api_create_device():
    """API per creare un nuovo dispositivo"""
    if not session.get('logged_in'):
        return jsonify({'success': False, 'error': 'Non autorizzato'}), 401

    try:
        device_data = request.get_json()

        # Validazione dati richiesti
        required_fields = ['name', 'uniqueId']
        for field in required_fields:
            if not device_data.get(field):
                return jsonify({'success': False, 'error': f'Campo {field} richiesto'}), 400

        # Controllo se l'IMEI esiste già
        existing_devices = traccar_api.get_devices()
        for device in existing_devices:
            if device.get('uniqueId') == device_data['uniqueId']:
                return jsonify({'success': False, 'error': 'IMEI già esistente'}), 400

        result = traccar_api.create_device(device_data)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/devices/<int:device_id>', methods=['PUT'])
def api_update_device(device_id):
    """API per aggiornare un dispositivo"""
    if not session.get('logged_in'):
        return jsonify({'success': False, 'error': 'Non autorizzato'}), 401

    try:
        device_data = request.get_json()

        # Assicurati che l'ID sia incluso nei dati
        device_data['id'] = device_id

        # Controllo se l'IMEI esiste già (escluso il dispositivo corrente)
        if 'uniqueId' in device_data:
            existing_devices = traccar_api.get_devices()
            for device in existing_devices:
                if device.get('uniqueId') == device_data['uniqueId'] and device.get('id') != device_id:
                    return jsonify({'success': False, 'error': 'IMEI già utilizzato da un altro dispositivo'}), 400

        result = traccar_api.update_device(device_id, device_data)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/devices/<int:device_id>', methods=['DELETE'])
def api_delete_device(device_id):
    """API per eliminare un dispositivo"""
    if not session.get('logged_in'):
        return jsonify({'success': False, 'error': 'Non autorizzato'}), 401

    try:
        result = traccar_api.delete_device(device_id)

        if result['success']:
            return jsonify({'success': True, 'message': 'Dispositivo eliminato con successo'}), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/devices/<int:device_id>', methods=['GET'])
def api_get_device(device_id):
    """API per ottenere un dispositivo specifico"""
    device = traccar_api.get_device_by_id(device_id)
    if device:
        return jsonify(device)
    else:
        return jsonify({'error': 'Dispositivo non trovato'}), 404


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
import requests
import json
import re
from flask import Flask, render_template, jsonify, request, session, redirect, url_for, flash
from datetime import datetime, timedelta
import os
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'your-secret-key-here')

# Configurazione Traccar
TRACCAR_SERVER = os.environ.get('TRACCAR_SERVER', 'http://localhost:8082')
TRACCAR_USERNAME = os.environ.get('TRACCAR_USERNAME', '')
TRACCAR_PASSWORD = os.environ.get('TRACCAR_PASSWORD', '')


def login_required(f):
    """Decorator per richiedere l'autenticazione"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in') or not session.get('traccar_session'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)

    return decorated_function


class TraccarAPI:
    def __init__(self, server_url, username=None, password=None):
        self.server_url = server_url.rstrip('/')
        self.session = requests.Session()
        self.current_user = None

        if username and password:
            self.login(username, password)

    def login(self, username, password):
        """Autentica con il server Traccar e ottiene i dati utente"""
        try:
            response = self.session.post(
                f"{self.server_url}/api/session",
                data={
                    'email': username,
                    'password': password
                }
            )

            if response.status_code == 200:
                user_data = response.json()
                self.current_user = user_data
                return {
                    'success': True,
                    'user': user_data,
                    'session_cookies': dict(self.session.cookies)
                }
            else:
                return {
                    'success': False,
                    'error': 'Credenziali non valide' if response.status_code == 401 else f'Errore server: {response.status_code}'
                }
        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'error': 'Impossibile connettersi al server Traccar. Verificare che sia online.'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Errore di connessione: {str(e)}'
            }

    def logout(self):
        """Logout dal server Traccar"""
        try:
            self.session.delete(f"{self.server_url}/api/session")
            self.current_user = None
        except Exception as e:
            print(f"Errore nel logout: {e}")

    def get_current_user(self):
        """Ottiene l'utente corrente"""
        return self.current_user

    def get_user_permissions(self):
        """Ottiene i permessi dell'utente corrente"""
        user = self.get_current_user()
        if not user:
            return {}

        # Mappa i permessi Traccar ai permessi interni
        permissions = {
            'admin': user.get('administrator', False),
            'administrator': user.get('administrator', False),  # Alias
            'manager': user.get('manager', False),
            'readonly': user.get('readonly', False),
            'deviceReadonly': user.get('deviceReadonly', False),
            'disableReports': user.get('disableReports', False),
            'limitCommands': user.get('limitCommands', False),
            'expirationTime': user.get('expirationTime'),
            'disabled': user.get('disabled', False)
        }

        print(f"TraccarAPI.get_user_permissions() returning: {permissions}")
        return permissions

    def can_access_device(self, device_id):
        """Verifica se l'utente può accedere a un dispositivo specifico"""
        user = self.get_current_user()
        if not user:
            return False

        # Gli amministratori possono accedere a tutto
        if user.get('administrator', False):
            return True

        # Verifica i permessi specifici per il dispositivo
        try:
            response = self.session.get(f"{self.server_url}/api/permissions")
            if response.status_code == 200:
                permissions = response.json()
                user_devices = [p['deviceId'] for p in permissions if p.get('userId') == user['id']]
                return int(device_id) in user_devices
            return False
        except Exception as e:
            print(f"Errore nel verificare i permessi del dispositivo: {e}")
            return False

    def get_user_devices(self):
        """Ottiene solo i dispositivi a cui l'utente ha accesso"""
        user = self.get_current_user()
        if not user:
            return []

        try:
            # Gli amministratori vedono tutti i dispositivi
            if user.get('administrator', False):
                return self.get_all_devices()

            # Altri utenti vedono solo i loro dispositivi
            all_devices = self.get_all_devices()
            response = self.session.get(f"{self.server_url}/api/permissions")

            if response.status_code == 200:
                permissions = response.json()
                user_device_ids = [p['deviceId'] for p in permissions if p.get('userId') == user['id']]
                user_devices = [d for d in all_devices if d['id'] in user_device_ids]
                return user_devices

            return []
        except Exception as e:
            print(f"Errore nel recuperare i dispositivi utente: {e}")
            return []

    def get_all_devices(self):
        """Ottiene tutti i dispositivi (solo per admin)"""
        try:
            response = self.session.get(f"{self.server_url}/api/devices")
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            print(f"Errore nel recuperare tutti i dispositivi: {e}")
            return []

    def get_devices(self):
        """Ottiene i dispositivi in base ai permessi utente"""
        return self.get_user_devices()

    def create_device(self, device_data):
        """Crea un nuovo dispositivo (richiede permessi admin/manager)"""
        user = self.get_current_user()
        permissions = self.get_user_permissions()

        if not (permissions.get('admin') or permissions.get('manager')):
            return {'success': False, 'error': 'Permessi insufficienti per creare dispositivi'}

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
        permissions = self.get_user_permissions()

        # Verifica permessi
        if permissions.get('readonly') or permissions.get('deviceReadonly'):
            return {'success': False, 'error': 'Permessi insufficienti per modificare dispositivi'}

        if not self.can_access_device(device_id):
            return {'success': False, 'error': 'Accesso negato al dispositivo'}

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
        permissions = self.get_user_permissions()

        # Solo admin e manager possono eliminare dispositivi
        if not (permissions.get('admin') or permissions.get('manager')):
            return {'success': False, 'error': 'Permessi insufficienti per eliminare dispositivi'}

        if not self.can_access_device(device_id):
            return {'success': False, 'error': 'Accesso negato al dispositivo'}

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
        if not self.can_access_device(device_id):
            return None

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
        if device_id and not self.can_access_device(device_id):
            return []

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
        if not self.can_access_device(device_id):
            return None

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
        permissions = self.get_user_permissions()

        if permissions.get('disableReports'):
            return []

        # Filtra solo i dispositivi accessibili
        accessible_device_ids = [did for did in device_ids if self.can_access_device(did)]

        try:
            params = {
                'deviceId': accessible_device_ids,
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

    # User Management Methods
    def get_users(self):
        """Ottiene tutti gli utenti (solo per admin)"""
        permissions = self.get_user_permissions()

        if not permissions.get('admin'):
            return {'success': False, 'error': 'Permessi insufficienti'}

        try:
            response = self.session.get(f"{self.server_url}/api/users")
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            print(f"Errore nel recuperare gli utenti: {e}")
            return []

    def create_user(self, user_data):
        """Crea un nuovo utente (solo per admin)"""
        permissions = self.get_user_permissions()

        if not permissions.get('admin'):
            return {'success': False, 'error': 'Permessi insufficienti per creare utenti'}

        try:
            response = self.session.post(
                f"{self.server_url}/api/users",
                headers={'Content-Type': 'application/json'},
                json=user_data
            )
            if response.status_code == 200:
                return {'success': True, 'data': response.json()}
            else:
                error_msg = response.text if response.text else f"Errore HTTP {response.status_code}"
                return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def update_user(self, user_id, user_data):
        """Aggiorna un utente esistente"""
        permissions = self.get_user_permissions()
        current_user = self.get_current_user()

        # Admin può modificare tutti, gli altri solo se stessi
        if not permissions.get('admin') and current_user.get('id') != user_id:
            return {'success': False, 'error': 'Permessi insufficienti per modificare questo utente'}

        try:
            response = self.session.put(
                f"{self.server_url}/api/users/{user_id}",
                headers={'Content-Type': 'application/json'},
                json=user_data
            )
            if response.status_code == 200:
                return {'success': True, 'data': response.json()}
            else:
                error_msg = response.text if response.text else f"Errore HTTP {response.status_code}"
                return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def delete_user(self, user_id):
        """Elimina un utente (solo per admin)"""
        permissions = self.get_user_permissions()
        current_user = self.get_current_user()

        if not permissions.get('admin'):
            return {'success': False, 'error': 'Permessi insufficienti per eliminare utenti'}

        # Non può eliminare se stesso
        if current_user.get('id') == user_id:
            return {'success': False, 'error': 'Non puoi eliminare il tuo stesso account'}

        try:
            response = self.session.delete(f"{self.server_url}/api/users/{user_id}")
            if response.status_code == 204:
                return {'success': True}
            else:
                error_msg = response.text if response.text else f"Errore HTTP {response.status_code}"
                return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_user_by_id(self, user_id):
        """Ottiene un utente specifico per ID"""
        permissions = self.get_user_permissions()
        current_user = self.get_current_user()

        # Admin può vedere tutti, gli altri solo se stessi
        if not permissions.get('admin') and current_user.get('id') != user_id:
            return None

        try:
            users = self.get_users()
            if isinstance(users, list):
                for user in users:
                    if user['id'] == int(user_id):
                        return user
            return None
        except Exception as e:
            print(f"Errore nel recuperare l'utente {user_id}: {e}")
            return None

    def get_user_permissions_for_devices(self, user_id):
        """Ottiene i permessi dispositivi per un utente specifico"""
        permissions = self.get_user_permissions()

        if not permissions.get('admin'):
            return {'success': False, 'error': 'Permessi insufficienti'}

        try:
            response = self.session.get(f"{self.server_url}/api/permissions")
            if response.status_code == 200:
                all_permissions = response.json()
                user_device_ids = [p['deviceId'] for p in all_permissions if p.get('userId') == user_id]
                return user_device_ids
            return []
        except Exception as e:
            print(f"Errore nel recuperare i permessi utente: {e}")
            return []

    def update_user_device_permissions(self, user_id, device_ids):
        """Aggiorna i permessi dispositivi per un utente"""
        permissions = self.get_user_permissions()

        if not permissions.get('admin'):
            return {'success': False, 'error': 'Permessi insufficienti'}

        try:
            # Prima rimuovi tutti i permessi esistenti per questo utente
            response = self.session.get(f"{self.server_url}/api/permissions")
            if response.status_code == 200:
                existing_permissions = response.json()
                user_permissions = [p for p in existing_permissions if p.get('userId') == user_id and 'deviceId' in p]

                # Rimuovi permessi esistenti
                for perm in user_permissions:
                    self.session.delete(f"{self.server_url}/api/permissions",
                                        json={'userId': user_id, 'deviceId': perm['deviceId']})

                # Aggiungi nuovi permessi
                for device_id in device_ids:
                    self.session.post(f"{self.server_url}/api/permissions",
                                      json={'userId': user_id, 'deviceId': device_id})

                return {'success': True}
            else:
                return {'success': False, 'error': 'Errore nel recupero permessi esistenti'}
        except Exception as e:
            return {'success': False, 'error': str(e)}


# Inizializza TraccarAPI globale
traccar_api = TraccarAPI(TRACCAR_SERVER)


@app.route('/')
def index():
    """Redirect alla dashboard se autenticato, altrimenti al login"""
    if session.get('logged_in'):
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    """Pagina di login - VERSIONE MIGLIORATA"""
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        # Login tramite API Traccar
        global traccar_api
        traccar_api = TraccarAPI(TRACCAR_SERVER)
        result = traccar_api.login(username, password)

        if result['success']:
            user_data = result['user']

            # Memorizza dati di sessione in modo più completo
            session['logged_in'] = True
            session['traccar_session'] = result['session_cookies']
            session['username'] = user_data.get('name', username)  # Fallback al nome utente
            session['user_email'] = user_data.get('email', username)  # Fallback all'email di login
            session['user_id'] = user_data.get('id')

            # Permessi più dettagliati
            session['user_admin'] = user_data.get('administrator', False)
            session['user_manager'] = user_data.get('manager', False)
            session['user_readonly'] = user_data.get('readonly', False)
            session['user_device_readonly'] = user_data.get('deviceReadonly', False)
            session['user_limit_commands'] = user_data.get('limitCommands', False)
            session['user_disable_reports'] = user_data.get('disableReports', False)
            session['user_disabled'] = user_data.get('disabled', False)

            print(f"Login successful for user: {user_data}")
            flash(f'Benvenuto {user_data.get("name", username)}!', 'success')

            # Redirect alla pagina richiesta o dashboard
            next_page = request.args.get('next')
            return redirect(next_page) if next_page else redirect(url_for('dashboard'))
        else:
            print(f"Login failed: {result}")
            return render_template('login.html', error=result['error'])

    return render_template('login.html')


def get_devices_robust(self):
    """Versione più robusta del recupero dispositivi con retry e debug"""
    try:
        print(f"get_devices_robust: Tentativo recupero dispositivi...")

        # Verifica prima lo stato dell'utente
        if not self.current_user:
            print("get_devices_robust: Nessun utente corrente")
            return []

        print(
            f"get_devices_robust: Utente corrente: {self.current_user.get('name')} (ID: {self.current_user.get('id')})")

        # Tentativo 1: Dispositivi utente specifici
        try:
            if self.current_user.get('administrator', False):
                print("get_devices_robust: Utente admin - recupero tutti i dispositivi")
                return self.get_all_devices()
            else:
                print("get_devices_robust: Utente normale - recupero dispositivi assegnati")
                return self.get_user_devices()
        except Exception as e:
            print(f"get_devices_robust: Errore nel recupero iniziale: {e}")

            # Tentativo 2: Recupero diretto
            try:
                print("get_devices_robust: Tentativo recupero diretto...")
                response = self.session.get(f"{self.server_url}/api/devices", timeout=10)
                print(f"get_devices_robust: Response status: {response.status_code}")

                if response.status_code == 200:
                    devices = response.json()
                    print(f"get_devices_robust: Recuperati {len(devices)} dispositivi")
                    return devices
                else:
                    print(f"get_devices_robust: Errore HTTP {response.status_code}: {response.text}")
                    return []
            except Exception as e2:
                print(f"get_devices_robust: Errore nel recupero diretto: {e2}")
                return []

    except Exception as e:
        print(f"get_devices_robust: Errore generale: {e}")
        return []

@app.route('/logout')
def logout():
    """Logout da Traccar e dalla sessione Flask"""
    try:
        # Logout da Traccar
        traccar_api.logout()
    except:
        pass  # Ignora errori di logout

    # Pulisci la sessione Flask
    flash('Logout effettuato con successo', 'info')
    session.clear()
    return redirect(url_for('login'))


@app.route('/settings')
def settings():
    """Logout da Traccar e dalla sessione Flask"""
    return render_template('settings.html')


@app.route('/api/devices/force-reload')
@login_required
def api_force_reload_devices():
    """Forza il reload dei dispositivi con debug completo"""
    try:
        print("=== FORCE RELOAD DEVICES ===")

        # Test connessione diretta
        import requests
        test_session = requests.Session()

        # Login diretto
        login_response = test_session.post(
            f"{TRACCAR_SERVER}/api/session",
            data={
                'email': TRACCAR_USERNAME or session.get('user_email'),
                'password': TRACCAR_PASSWORD or 'password_placeholder'  # In produzione usa un sistema sicuro
            }
        )

        print(f"Login diretto status: {login_response.status_code}")

        if login_response.status_code == 200:
            user_data = login_response.json()
            print(f"Login diretto successful: {user_data.get('name')}")

            # Recupero dispositivi
            devices_response = test_session.get(f"{TRACCAR_SERVER}/api/devices")
            print(f"Devices response status: {devices_response.status_code}")

            if devices_response.status_code == 200:
                devices = devices_response.json()
                print(f"Dispositivi trovati: {len(devices)}")

                return jsonify({
                    'success': True,
                    'devices': devices,
                    'count': len(devices),
                    'user': user_data
                })
            else:
                return jsonify({
                    'success': False,
                    'error': f'Errore recupero dispositivi: {devices_response.status_code}',
                    'response': devices_response.text
                })
        else:
            return jsonify({
                'success': False,
                'error': f'Errore login: {login_response.status_code}',
                'response': login_response.text
            })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        })

@app.route('/dashboard')
@login_required
def dashboard():
    """Dashboard con lista dispositivi dell'utente"""
    user_data = {
        'name': session.get('username'),
        'email': session.get('user_email'),
        'admin': session.get('user_admin', False),
        'manager': session.get('user_manager', False),
        'readonly': session.get('user_readonly', False)
    }

    return render_template('dashboard.html', user=user_data)


@app.route('/devices')
@login_required
def devices_management():
    """Pagina gestione dispositivi - VERSIONE CORRETTA"""

    # DEBUG: Stampa informazioni di sessione
    print("=== DEBUG GESTIONE DISPOSITIVI ===")
    print(f"Session logged_in: {session.get('logged_in', False)}")
    print(f"Session username: {session.get('username')}")
    print(f"Session user_admin: {session.get('user_admin', False)}")
    print(f"Session user_manager: {session.get('user_manager', False)}")
    print(f"Session user_readonly: {session.get('user_readonly', False)}")

    # Ottieni anche i permessi via API
    try:
        permissions = traccar_api.get_user_permissions()
        current_user = traccar_api.get_current_user()
        print(f"API current_user: {current_user}")
        print(f"API permissions: {permissions}")
    except Exception as e:
        print(f"Errore nel recupero permessi API: {e}")
        permissions = {}
        current_user = None

    # CONTROLLO PERMESSI SEMPLIFICATO
    # Per ora, permetti l'accesso a tutti gli utenti autenticati per il debug
    # In produzione, potrai riattivare i controlli più restrittivi

    is_admin = (session.get('user_admin', False) or
                permissions.get('admin', False) or
                permissions.get('administrator', False))

    is_manager = (session.get('user_manager', False) or
                  permissions.get('manager', False))

    is_readonly = (session.get('user_readonly', False) or
                   permissions.get('readonly', False))

    print(f"Final permissions - Admin: {is_admin}, Manager: {is_manager}, Readonly: {is_readonly}")

    # TEMPORANEO: Commenta il controllo permessi per debug
    # if not (is_admin or is_manager):
    #     print("ACCESSO NEGATO - Permessi insufficienti")
    #     flash('Permessi insufficienti per gestire i dispositivi', 'error')
    #     return redirect(url_for('dashboard'))

    print("ACCESSO CONSENTITO - Caricamento pagina dispositivi")

    # Passa i permessi al template
    template_permissions = {
        'admin': is_admin,
        'manager': is_manager,
        'readonly': is_readonly
    }

    return render_template('devices_management.html', permissions=template_permissions)
@app.route('/debug/permissions')
@login_required
def debug_permissions():
    """Endpoint di debug per controllare i permessi (RIMUOVERE IN PRODUZIONE)"""

    user_info = {
        'session': {
            'user_id': session.get('user_id'),
            'username': session.get('username'),
            'user_admin': session.get('user_admin', False),
            'user_manager': session.get('user_manager', False),
            'user_readonly': session.get('user_readonly', False)
        },
        'api_user': traccar_api.get_current_user(),
        'api_permissions': traccar_api.get_user_permissions()
    }

    return jsonify(user_info)

@app.route('/users')
@login_required
def user_management():
    """Pagina gestione utenti"""
    permissions = traccar_api.get_user_permissions()

    # Solo admin possono gestire utenti
    if not permissions.get('admin'):
        flash('Permessi insufficienti per gestire gli utenti', 'error')
        return redirect(url_for('dashboard'))

    return render_template('user_management.html', permissions=permissions)


# API Routes con controllo permessi
@app.route('/api/devices', methods=['GET'])
@login_required
def api_devices():
    """API per ottenere i dispositivi dell'utente - VERSIONE CORRETTA"""
    try:
        print("=== DEBUG API DEVICES ===")

        # Verifica stato della sessione Traccar
        current_user = traccar_api.get_current_user()
        print(f"Current user from TraccarAPI: {current_user}")

        if not current_user:
            print("Utente non autenticato in TraccarAPI, tentativo di re-login...")

            # Tenta il re-login se non c'è utente corrente
            username = session.get('username')
            # Nota: in un ambiente reale, non dovresti memorizzare la password
            # Questo è solo per il debug - dovrai implementare un sistema più sicuro
            if username and TRACCAR_USERNAME and TRACCAR_PASSWORD:
                result = traccar_api.login(TRACCAR_USERNAME, TRACCAR_PASSWORD)
                print(f"Re-login result: {result}")

                if not result['success']:
                    return jsonify({'error': 'Sessione Traccar scaduta', 'details': result.get('error')}), 401
            else:
                return jsonify({'error': 'Credenziali Traccar non disponibili'}), 401

        # Ottieni i dispositivi
        print("Tentativo di recupero dispositivi...")
        devices = traccar_api.get_devices()
        print(f"Dispositivi ottenuti: {len(devices) if isinstance(devices, list) else 'Errore'}")

        # Se i dispositivi sono vuoti, prova a ottenere tutti i dispositivi (per admin)
        if isinstance(devices, list) and len(devices) == 0:
            print("Nessun dispositivo trovato, tentativo recupero tutti i dispositivi...")
            all_devices = traccar_api.get_all_devices()
            print(f"Tutti i dispositivi: {len(all_devices) if isinstance(all_devices, list) else 'Errore'}")

            # Se sei admin, restituisci tutti i dispositivi
            permissions = traccar_api.get_user_permissions()
            if permissions.get('admin') or permissions.get('administrator'):
                devices = all_devices
                print("Utente admin - restituisco tutti i dispositivi")

        return jsonify(devices if isinstance(devices, list) else [])

    except Exception as e:
        print(f"Errore in api_devices: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Errore interno: {str(e)}'}), 500


@app.route('/api/debug/traccar-status')
@login_required
def debug_traccar_status():
    """Endpoint di debug per verificare lo stato della connessione Traccar"""
    try:
        # Test diretto della connessione
        import requests

        # Test connessione base
        response = requests.get(f"{TRACCAR_SERVER}/api/server", timeout=10)
        server_reachable = response.status_code == 200

        # Test sessione corrente
        current_user = traccar_api.get_current_user()
        session_valid = current_user is not None

        # Test API dispositivi diretta
        devices_response = None
        devices_error = None

        try:
            devices_response = traccar_api.session.get(f"{TRACCAR_SERVER}/api/devices", timeout=10)
            devices_status = devices_response.status_code
            devices_count = len(devices_response.json()) if devices_status == 200 else 0
        except Exception as e:
            devices_error = str(e)
            devices_status = None
            devices_count = 0

        debug_info = {
            'traccar_server': TRACCAR_SERVER,
            'server_reachable': server_reachable,
            'session_valid': session_valid,
            'current_user': current_user,
            'flask_session': {
                'logged_in': session.get('logged_in'),
                'username': session.get('username'),
                'user_admin': session.get('user_admin'),
                'user_manager': session.get('user_manager'),
            },
            'devices_api': {
                'status_code': devices_status,
                'count': devices_count,
                'error': devices_error
            },
            'permissions': traccar_api.get_user_permissions()
        }

        return jsonify(debug_info)

    except Exception as e:
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc() if 'traceback' in globals() else None
        })

@app.route('/api/devices', methods=['POST'])
@login_required
def api_create_device():
    """API per creare un nuovo dispositivo"""
    try:
        device_data = request.get_json()

        # Validazione dati richiesti
        required_fields = ['name', 'uniqueId']
        for field in required_fields:
            if not device_data.get(field):
                return jsonify({'success': False, 'error': f'Campo {field} richiesto'}), 400

        result = traccar_api.create_device(device_data)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/devices/<int:device_id>', methods=['PUT'])
@login_required
def api_update_device(device_id):
    """API per aggiornare un dispositivo"""
    try:
        device_data = request.get_json()
        device_data['id'] = device_id

        result = traccar_api.update_device(device_id, device_data)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/devices/<int:device_id>', methods=['DELETE'])
@login_required
def api_delete_device(device_id):
    """API per eliminare un dispositivo"""
    try:
        result = traccar_api.delete_device(device_id)

        if result['success']:
            return jsonify({'success': True, 'message': 'Dispositivo eliminato con successo'}), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/devices/<int:device_id>', methods=['GET'])
@login_required
def api_get_device(device_id):
    """API per ottenere un dispositivo specifico"""
    device = traccar_api.get_device_by_id(device_id)
    if device:
        return jsonify(device)
    else:
        return jsonify({'error': 'Dispositivo non trovato o accesso negato'}), 404


@app.route('/api/positions')
@login_required
def api_positions():
    """API per ottenere le posizioni"""
    device_id = request.args.get('deviceId')
    hours = int(request.args.get('hours', 24))

    to_time = datetime.utcnow()
    from_time = to_time - timedelta(hours=hours)

    positions = traccar_api.get_positions(device_id, from_time, to_time)
    return jsonify(positions)


@app.route('/api/device/<int:device_id>/status')
@login_required
def api_device_status(device_id):
    """API per ottenere lo status di un dispositivo"""
    status = traccar_api.get_device_status(device_id)
    if status is None and not traccar_api.can_access_device(device_id):
        return jsonify({'error': 'Accesso negato'}), 403
    return jsonify(status)


@app.route('/api/user/info')
@login_required
def api_user_info():
    """API per ottenere informazioni sull'utente corrente"""
    user = traccar_api.get_current_user()
    permissions = traccar_api.get_user_permissions()

    return jsonify({
        'user': user,
        'permissions': permissions
    })


# User Management API Routes
@app.route('/api/users', methods=['GET'])
@login_required
def api_users():
    """API per ottenere tutti gli utenti"""
    users = traccar_api.get_users()

    if isinstance(users, dict) and not users.get('success', True):
        return jsonify({'error': users.get('error', 'Errore nel caricamento utenti')}), 403

    return jsonify(users)


@app.route('/api/users', methods=['POST'])
@login_required
def api_create_user():
    """API per creare un nuovo utente"""
    try:
        user_data = request.get_json()

        # Validazione dati richiesti
        required_fields = ['name', 'email', 'password']
        for field in required_fields:
            if not user_data.get(field):
                return jsonify({'success': False, 'error': f'Campo {field} richiesto'}), 400

        # Validazione email
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, user_data['email']):
            return jsonify({'success': False, 'error': 'Formato email non valido'}), 400

        # Validazione password
        if len(user_data['password']) < 6:
            return jsonify({'success': False, 'error': 'Password deve essere di almeno 6 caratteri'}), 400

        result = traccar_api.create_user(user_data)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/users/<int:user_id>', methods=['PUT'])
@login_required
def api_update_user(user_id):
    """API per aggiornare un utente"""
    try:
        user_data = request.get_json()
        user_data['id'] = user_id

        # Validazione email se presente
        if 'email' in user_data:
            email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            if not re.match(email_regex, user_data['email']):
                return jsonify({'success': False, 'error': 'Formato email non valido'}), 400

        # Validazione password se presente
        if 'password' in user_data and user_data['password']:
            if len(user_data['password']) < 6:
                return jsonify({'success': False, 'error': 'Password deve essere di almeno 6 caratteri'}), 400

        result = traccar_api.update_user(user_id, user_data)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@login_required
def api_delete_user(user_id):
    """API per eliminare un utente"""
    try:
        result = traccar_api.delete_user(user_id)

        if result['success']:
            return jsonify({'success': True, 'message': 'Utente eliminato con successo'}), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/users/<int:user_id>', methods=['GET'])
@login_required
def api_get_user(user_id):
    """API per ottenere un utente specifico"""
    user = traccar_api.get_user_by_id(user_id)
    if user:
        return jsonify(user)
    else:
        return jsonify({'error': 'Utente non trovato o accesso negato'}), 404


@app.route('/api/users/device-counts', methods=['GET'])
@login_required
def api_users_device_counts():
    """API per ottenere il conteggio dispositivi per tutti gli utenti"""
    permissions = traccar_api.get_user_permissions()

    if not permissions.get('admin'):
        return jsonify({'error': 'Permessi insufficienti'}), 403

    try:
        # Ottieni tutti gli utenti e tutte le permissions
        users = traccar_api.get_users()
        if isinstance(users, dict) and not users.get('success', True):
            return jsonify({})

        # Ottieni tutte le permissions
        response = traccar_api.session.get(f"{TRACCAR_SERVER}/api/permissions")
        if response.status_code != 200:
            return jsonify({})

        permissions_data = response.json()

        # Conta i dispositivi per ogni utente
        device_counts = {}
        for user in users:
            user_id = user['id']
            count = len([p for p in permissions_data if p.get('userId') == user_id and 'deviceId' in p])
            device_counts[user_id] = count

        return jsonify(device_counts)

    except Exception as e:
        print(f"Errore nel calcolo conteggi dispositivi: {e}")
        return jsonify({})


@app.route('/api/users/<int:user_id>/permissions', methods=['GET'])
@login_required
def api_get_user_permissions(user_id):
    """API per ottenere i permessi dispositivi di un utente"""
    permissions = traccar_api.get_user_permissions_for_devices(user_id)

    if isinstance(permissions, dict) and not permissions.get('success', True):
        return jsonify({'error': permissions.get('error', 'Errore nel caricamento permessi')}), 403

    return jsonify(permissions)


@app.route('/api/users/<int:user_id>/permissions', methods=['PUT'])
@login_required
def api_update_user_permissions(user_id):
    """API per aggiornare i permessi dispositivi di un utente"""
    try:
        data = request.get_json()
        device_ids = data.get('deviceIds', [])

        result = traccar_api.update_user_device_permissions(user_id, device_ids)

        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/server/info')
@login_required
def api_server_info():
    """API per ottenere informazioni del server Traccar"""
    permissions = traccar_api.get_user_permissions()

    if not permissions.get('admin'):
        return jsonify({'error': 'Permessi insufficienti'}), 403

    try:
        # Ottieni informazioni del server
        response = traccar_api.session.get(f"{TRACCAR_SERVER}/api/server")
        if response.status_code == 200:
            server_info = response.json()

            # Aggiungi informazioni aggiuntive se disponibili
            try:
                # Statistiche connessioni (se disponibili)
                stats_response = traccar_api.session.get(f"{TRACCAR_SERVER}/api/statistics")
                if stats_response.status_code == 200:
                    stats = stats_response.json()
                    server_info.update(stats)
            except:
                pass

            return jsonify(server_info)
        else:
            return jsonify({'error': 'Errore nel recupero informazioni server'}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/device/<int:device_id>')
@login_required
def device_detail(device_id):
    """Pagina dettaglio dispositivo"""
    device = traccar_api.get_device_by_id(device_id)

    if not device:
        flash('Dispositivo non trovato o accesso negato', 'error')
        return redirect(url_for('dashboard'))

    return render_template('device_detail.html', device=device)


@app.route('/map')
@login_required
def map_view():
    """Visualizzazione mappa"""
    return render_template('map.html')


@app.route('/reports')
@login_required
def reports():
    """Pagina reports"""
    permissions = traccar_api.get_user_permissions()

    if permissions.get('disableReports'):
        flash('I report sono disabilitati per il tuo account', 'warning')
        return redirect(url_for('dashboard'))

    return render_template('reports.html')


@app.route('/api/reports/route')
@login_required
def api_reports_route():
    """API per i report delle rotte"""
    device_ids = request.args.getlist('deviceId')
    days = int(request.args.get('days', 1))

    to_time = datetime.utcnow()
    from_time = to_time - timedelta(days=days)

    reports = traccar_api.get_reports_route(device_ids, from_time, to_time)
    return jsonify(reports)


# AGGIUNGI QUESTO ENDPOINT nel tuo app.py (prima degli error handlers)

@app.route('/api/server/status')
@login_required
def api_server_status():
    """API per verificare lo status del server Traccar"""
    try:
        # Test della connessione a Traccar
        response = requests.get(f"{TRACCAR_SERVER}/api/server", timeout=5)
        if response.status_code == 200:
            server_info = response.json()
            return jsonify({
                'status': 'online',
                'server': server_info,
                'timestamp': datetime.utcnow().isoformat()
            })
        else:
            return jsonify({
                'status': 'error',
                'message': f'Server risponde con status {response.status_code}',
                'timestamp': datetime.utcnow().isoformat()
            })
    except requests.exceptions.ConnectionError:
        return jsonify({
            'status': 'offline',
            'message': 'Server Traccar non raggiungibile',
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e),
            'timestamp': datetime.utcnow().isoformat()
        })


# OPZIONALE: Aggiungi anche questo endpoint per i dispositivi
@app.route('/api/devices/status')
@login_required
def api_devices_status():
    """API per ottenere lo status di tutti i dispositivi dell'utente"""
    try:
        devices = traccar_api.get_devices()
        device_status = []

        for device in devices:
            status = traccar_api.get_device_status(device['id'])
            device_status.append({
                'device': device,
                'status': status,
                'online': status is not None and (
                        datetime.utcnow() - datetime.fromisoformat(status['serverTime'].replace('Z', '+00:00'))
                ).total_seconds() < 300  # Online se ultimo aggiornamento < 5 minuti
            })

        return jsonify(device_status)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
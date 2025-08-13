# reports_repository.py - Sistema di gestione repository reports (AGGIORNATO CON SUPPORTO PDF)

import os
import json
import datetime
from pathlib import Path
from flask import Blueprint, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
import uuid
import zipfile
import io
import mimetypes

# Configurazione
REPORTS_DIR = Path("reports")
PDF_REPORTS_DIR = REPORTS_DIR / "pdfs"
JSON_REPORTS_DIR = REPORTS_DIR / "json"
METADATA_FILE = REPORTS_DIR / "metadata.json"

# Crea directory se non esistono
REPORTS_DIR.mkdir(exist_ok=True)
PDF_REPORTS_DIR.mkdir(exist_ok=True)
JSON_REPORTS_DIR.mkdir(exist_ok=True)

# Blueprint per le route
reports_repo_bp = Blueprint('reports_repo', __name__)


class ReportsRepository:
    def __init__(self):
        self.metadata_file = METADATA_FILE
        self.reports_dir = REPORTS_DIR
        self.pdf_dir = PDF_REPORTS_DIR
        self.json_dir = JSON_REPORTS_DIR
        self._ensure_metadata_exists()

    def _ensure_metadata_exists(self):
        """Crea il file metadata se non esiste"""
        if not self.metadata_file.exists():
            initial_data = {
                "reports": [],
                "stats": {
                    "total_reports": 0,
                    "total_json_reports": 0,
                    "total_pdf_reports": 0,
                    "total_size_mb": 0,
                    "last_cleanup": None
                },
                "created_at": datetime.datetime.now().isoformat()
            }
            self._save_metadata(initial_data)
        else:
            # Migrazione automatica del metadata esistente
            self._migrate_metadata_if_needed()

    def _migrate_metadata_if_needed(self):
        """Migra il metadata esistente per supportare PDF"""
        try:
            metadata = self._load_metadata()

            # Controlla se mancano le nuove chiavi
            needs_migration = False

            if 'total_json_reports' not in metadata['stats']:
                metadata['stats']['total_json_reports'] = len(
                    [r for r in metadata['reports'] if r.get('format', 'json') == 'json'])
                needs_migration = True

            if 'total_pdf_reports' not in metadata['stats']:
                metadata['stats']['total_pdf_reports'] = len(
                    [r for r in metadata['reports'] if r.get('format') == 'pdf'])
                needs_migration = True

            # Aggiungi formato ai report esistenti se mancante
            for report in metadata['reports']:
                if 'format' not in report:
                    report['format'] = 'json'
                    needs_migration = True

            if needs_migration:
                print("🔄 Migrazione metadata reports per supporto PDF...")
                self._save_metadata(metadata)
                print("✅ Migrazione completata")

        except Exception as e:
            print(f"⚠️ Errore migrazione metadata: {e}")

    def _load_metadata(self):
        """Carica metadata dal file JSON"""
        try:
            with open(self.metadata_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self._ensure_metadata_exists()
            return self._load_metadata()

    def _save_metadata(self, data):
        """Salva metadata nel file JSON"""
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    def _get_file_directory(self, file_format):
        """Restituisce la directory appropriata in base al formato"""
        if file_format == 'pdf':
            return self.pdf_dir
        else:
            return self.json_dir

    def _get_file_extension(self, file_format):
        """Restituisce l'estensione appropriata in base al formato"""
        if file_format == 'pdf':
            return '.pdf'
        else:
            return '.json'

    def _get_mimetype(self, file_format):
        """Restituisce il mimetype appropriato in base al formato"""
        if file_format == 'pdf':
            return 'application/pdf'
        else:
            return 'application/json'

    def save_report(self, report_data, filename=None, file_format='json'):
        """
        Salva un report nel repository

        Args:
            report_data: Dati del report (dict per JSON, bytes per PDF)
            filename: Nome del file (opzionale)
            file_format: 'json' o 'pdf'
        """
        try:
            # Valida il formato
            if file_format not in ['json', 'pdf']:
                return {
                    "success": False,
                    "error": "Formato non supportato. Usa 'json' o 'pdf'"
                }

            # Genera filename se non fornito
            if not filename:
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                if file_format == 'json':
                    report_type = report_data.get('type', 'unknown')
                    filename = f"report_{report_type}_{timestamp}"
                else:
                    filename = f"report_pdf_{timestamp}"

            # Assicura che il filename sia sicuro e abbia l'estensione corretta
            filename = secure_filename(filename)
            extension = self._get_file_extension(file_format)
            if not filename.endswith(extension):
                filename += extension

            # Percorso completo del file nella directory appropriata
            file_dir = self._get_file_directory(file_format)
            filepath = file_dir / filename

            # Genera ID univoco per il report
            report_id = str(uuid.uuid4())

            # Prepara i metadati base
            report_metadata = {
                "id": report_id,
                "filename": filename,
                "format": file_format,
                "created_at": datetime.datetime.now().isoformat(),
                "file_size": 0  # Sarà calcolato dopo il salvataggio
            }

            # Salva il file in base al formato
            if file_format == 'json':
                # Per JSON, aggiungi metadata completi ai dati
                report_with_metadata = {
                    **report_metadata,
                    "type": report_data.get('type', 'unknown'),
                    "title": report_data.get('title', f"Report {report_data.get('type', 'Unknown')}"),
                    "description": report_data.get('description', ''),
                    "devices_count": len(report_data.get('data', [])),
                    "period": report_data.get('period', {}),
                    "totals": report_data.get('totals', {}),
                    "data": report_data.get('data', []),
                    "generated_by": report_data.get('generated_by', 'System')
                }

                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(report_with_metadata, f, indent=2, ensure_ascii=False, default=str)

                # Aggiorna metadata per l'indice
                report_metadata.update({
                    "type": report_with_metadata['type'],
                    "title": report_with_metadata['title'],
                    "description": report_with_metadata['description'],
                    "devices_count": report_with_metadata['devices_count']
                })

            else:  # PDF
                # Per PDF, salva i bytes direttamente
                if isinstance(report_data, dict):
                    return {
                        "success": False,
                        "error": "Per salvare PDF, fornire i dati come bytes"
                    }

                with open(filepath, 'wb') as f:
                    f.write(report_data)

                # Per PDF, usa metadati minimi
                report_metadata.update({
                    "type": "pdf_report",
                    "title": f"Report PDF {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}",
                    "description": "Report esportato in formato PDF",
                    "devices_count": 0  # Non disponibile per PDF
                })

            # Calcola la dimensione del file
            file_size = filepath.stat().st_size
            report_metadata['file_size'] = file_size

            # Aggiorna metadata generale
            metadata = self._load_metadata()
            metadata['reports'].append(report_metadata)
            metadata['stats']['total_reports'] += 1

            if file_format == 'json':
                metadata['stats']['total_json_reports'] += 1
            else:
                metadata['stats']['total_pdf_reports'] += 1

            metadata['stats']['total_size_mb'] = round(
                sum(r['file_size'] for r in metadata['reports']) / (1024 * 1024), 2
            )

            self._save_metadata(metadata)

            return {
                "success": True,
                "report_id": report_id,
                "filename": filename,
                "format": file_format,
                "file_size": file_size,
                "message": f"Report {file_format.upper()} salvato con successo: {filename}"
            }

        except Exception as e:
            print(f"Errore nel salvataggio del report: {e}")
            import traceback
            traceback.print_exc()

            return {
                "success": False,
                "error": str(e),
                "message": f"Errore nel salvataggio del report: {str(e)}"
            }

    def save_pdf_report(self, pdf_bytes, filename=None, title=None, description=None):
        """
        Metodo specifico per salvare report PDF

        Args:
            pdf_bytes: Dati del PDF come bytes
            filename: Nome del file (opzionale)
            title: Titolo del report (opzionale)
            description: Descrizione del report (opzionale)
        """
        result = self.save_report(pdf_bytes, filename, 'pdf')

        # Se sono stati forniti title e description personalizzati, aggiorna i metadata
        if result['success'] and (title or description):
            try:
                metadata = self._load_metadata()
                for report in metadata['reports']:
                    if report['id'] == result['report_id']:
                        if title:
                            report['title'] = title
                        if description:
                            report['description'] = description
                        break
                self._save_metadata(metadata)
                result['message'] = f"Report PDF salvato con titolo personalizzato: {filename}"
            except Exception as e:
                print(f"Errore nell'aggiornamento metadati personalizzati: {e}")

        return result

    def get_reports_list(self, limit=None, report_type=None, file_format=None):
        """Ottiene la lista dei reports salvati con filtri opzionali"""
        metadata = self._load_metadata()
        reports = metadata['reports']

        # Filtra per tipo se specificato
        if report_type:
            reports = [r for r in reports if r.get('type') == report_type]

        # Filtra per formato se specificato
        if file_format:
            reports = [r for r in reports if r.get('format') == file_format]

        # Ordina per data di creazione (più recenti primi)
        reports.sort(key=lambda x: x['created_at'], reverse=True)

        # Limita i risultati se specificato
        if limit:
            reports = reports[:limit]

        return {
            "success": True,
            "reports": reports,
            "stats": metadata['stats'],
            "total_count": len(metadata['reports']),
            "filtered_count": len(reports)
        }

    def get_report(self, report_id):
        """Ottiene un report specifico per ID"""
        try:
            metadata = self._load_metadata()
            report_entry = next((r for r in metadata['reports'] if r['id'] == report_id), None)

            if not report_entry:
                return {"success": False, "error": "Report non trovato"}

            file_format = report_entry.get('format', 'json')
            file_dir = self._get_file_directory(file_format)
            filepath = file_dir / report_entry['filename']

            if not filepath.exists():
                return {"success": False, "error": "File del report non trovato"}

            if file_format == 'json':
                with open(filepath, 'r', encoding='utf-8') as f:
                    report_data = json.load(f)

                return {
                    "success": True,
                    "report": report_data,
                    "format": file_format
                }
            else:  # PDF
                return {
                    "success": True,
                    "report": report_entry,  # Solo metadata per PDF
                    "format": file_format,
                    "filepath": str(filepath),
                    "message": "Per i PDF, utilizza l'endpoint di download per ottenere il file"
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def delete_report(self, report_id):
        """Elimina un report"""
        try:
            metadata = self._load_metadata()
            report_entry = next((r for r in metadata['reports'] if r['id'] == report_id), None)

            if not report_entry:
                return {"success": False, "error": "Report non trovato"}

            # Determina la directory corretta
            file_format = report_entry.get('format', 'json')
            file_dir = self._get_file_directory(file_format)
            filepath = file_dir / report_entry['filename']

            # Elimina il file se esiste
            if filepath.exists():
                filepath.unlink()

            # Rimuovi dall'indice
            metadata['reports'] = [r for r in metadata['reports'] if r['id'] != report_id]
            metadata['stats']['total_reports'] = len(metadata['reports'])

            # Aggiorna contatori per formato
            json_count = len([r for r in metadata['reports'] if r.get('format') == 'json'])
            pdf_count = len([r for r in metadata['reports'] if r.get('format') == 'pdf'])
            metadata['stats']['total_json_reports'] = json_count
            metadata['stats']['total_pdf_reports'] = pdf_count

            metadata['stats']['total_size_mb'] = round(
                sum(r['file_size'] for r in metadata['reports']) / (1024 * 1024), 2
            )

            self._save_metadata(metadata)

            return {
                "success": True,
                "message": f"Report {file_format.upper()} eliminato con successo"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def export_all_reports(self):
        """Crea un file ZIP con tutti i reports"""
        try:
            zip_buffer = io.BytesIO()

            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                # Aggiungi il file metadata
                zip_file.write(self.metadata_file, "metadata.json")

                # Aggiungi tutti i files JSON
                for report_file in self.json_dir.glob("*.json"):
                    zip_file.write(report_file, f"reports/json/{report_file.name}")

                # Aggiungi tutti i files PDF
                for report_file in self.pdf_dir.glob("*.pdf"):
                    zip_file.write(report_file, f"reports/pdf/{report_file.name}")

            zip_buffer.seek(0)

            return {
                "success": True,
                "zip_data": zip_buffer.getvalue(),
                "filename": f"traccar_reports_backup_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


# Istanza globale del repository
repo = ReportsRepository()


# ==================== ROUTES API ====================

@reports_repo_bp.route('/api/reports', methods=['GET'])
def api_get_reports():
    """API per ottenere la lista dei reports"""
    limit = request.args.get('limit', type=int)
    report_type = request.args.get('type')
    file_format = request.args.get('format')  # Nuovo parametro per il formato

    result = repo.get_reports_list(limit=limit, report_type=report_type, file_format=file_format)
    return jsonify(result)


@reports_repo_bp.route('/api/reports', methods=['POST'])
def api_save_report():
    """API per salvare un nuovo report (JSON)"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "Dati mancanti"}), 400

        filename = request.args.get('filename')
        result = repo.save_report(data, filename, 'json')

        status_code = 201 if result['success'] else 400
        return jsonify(result), status_code

    except Exception as e:
        print(f"Errore API save report: {e}")
        import traceback
        traceback.print_exc()

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@reports_repo_bp.route('/api/reports/pdf', methods=['POST'])
def api_save_pdf_report():
    """API per salvare un report PDF"""
    try:
        print("=== API SAVE PDF REPORT ===")
        print(f"Request files: {request.files}")
        print(f"Request form: {request.form}")

        # Controllo se il file è stato caricato
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "Nessun file PDF fornito"}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({"success": False, "error": "Nome file vuoto"}), 400

        # Verifica che sia un PDF
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({"success": False, "error": "Il file deve essere un PDF"}), 400

        # Leggi i dati del file
        pdf_bytes = file.read()
        print(f"PDF bytes read: {len(pdf_bytes)}")

        # Ottieni parametri opzionali
        title = request.form.get('title')
        description = request.form.get('description')
        filename = request.form.get('filename') or file.filename

        print(f"Title: {title}")
        print(f"Description: {description}")
        print(f"Filename: {filename}")

        result = repo.save_pdf_report(pdf_bytes, filename, title, description)
        print(f"Save result: {result}")

        status_code = 201 if result['success'] else 400
        return jsonify(result), status_code

    except Exception as e:
        print(f"Errore API save PDF: {e}")
        import traceback
        traceback.print_exc()

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@reports_repo_bp.route('/api/reports/<report_id>', methods=['GET'])
def api_get_report(report_id):
    """API per ottenere un report specifico"""
    result = repo.get_report(report_id)
    status_code = 200 if result['success'] else 404
    return jsonify(result), status_code


@reports_repo_bp.route('/api/reports/<report_id>', methods=['DELETE'])
def api_delete_report(report_id):
    """API per eliminare un report"""
    result = repo.delete_report(report_id)
    status_code = 200 if result['success'] else 404
    return jsonify(result), status_code


@reports_repo_bp.route('/api/reports/<report_id>/download', methods=['GET'])
def api_download_report(report_id):
    """API per scaricare un report"""
    result = repo.get_report(report_id)

    if not result['success']:
        return jsonify(result), 404

    # Trova il file fisico
    metadata = repo._load_metadata()
    report_entry = next((r for r in metadata['reports'] if r['id'] == report_id), None)

    if not report_entry:
        return jsonify({"success": False, "error": "Report non trovato"}), 404

    file_format = report_entry.get('format', 'json')
    file_dir = repo._get_file_directory(file_format)
    filepath = file_dir / report_entry['filename']

    if not filepath.exists():
        return jsonify({"success": False, "error": "File non trovato"}), 404

    mimetype = repo._get_mimetype(file_format)

    return send_file(
        filepath,
        as_attachment=True,
        download_name=report_entry['filename'],
        mimetype=mimetype
    )


@reports_repo_bp.route('/api/reports/export/all', methods=['GET'])
def api_export_all_reports():
    """API per esportare tutti i reports in un ZIP"""
    result = repo.export_all_reports()

    if not result['success']:
        return jsonify(result), 500

    return send_file(
        io.BytesIO(result['zip_data']),
        as_attachment=True,
        download_name=result['filename'],
        mimetype='application/zip'
    )


@reports_repo_bp.route('/api/reports/cleanup', methods=['POST'])
def api_cleanup_reports():
    """API per pulire reports vecchi"""
    days_old = request.args.get('days', 30, type=int)
    file_format = request.args.get('format')  # Nuovo: cleanup per formato specifico

    result = repo.cleanup_old_reports(days_old, file_format)
    return jsonify(result)


@reports_repo_bp.route('/api/reports/stats', methods=['GET'])
def api_get_stats():
    """API per ottenere statistiche sui reports"""
    metadata = repo._load_metadata()
    return jsonify({
        "success": True,
        "stats": metadata['stats']
    })


# ==================== ROUTE WEB ====================

@reports_repo_bp.route('/reports/repository')
def reports_repository_page():
    """Pagina web per gestire il repository dei reports"""
    return render_template('reports_repository.html')


# ==================== FUNZIONI DI UTILITÀ ====================

def init_reports_repository(app):
    """Inizializza il sistema di repository reports"""
    app.register_blueprint(reports_repo_bp)

    # Crea directory se non esistono
    REPORTS_DIR.mkdir(exist_ok=True)
    PDF_REPORTS_DIR.mkdir(exist_ok=True)
    JSON_REPORTS_DIR.mkdir(exist_ok=True)

    print(f"✅ Reports Repository inizializzato:")
    print(f"   📁 Directory principale: {REPORTS_DIR.absolute()}")
    print(f"   📄 Directory JSON: {JSON_REPORTS_DIR.absolute()}")
    print(f"   📋 Directory PDF: {PDF_REPORTS_DIR.absolute()}")

    return repo
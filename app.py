import os
import re
import tempfile
import uuid

from flask import Flask, jsonify, render_template, request, send_file

from excel_utils import copy_excel_with_mapping, read_excel_headers


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

ALLOWED_EXTENSIONS = {"xls", "xlsx"}
APP_TEMP_DIR = os.environ.get(
    "EXCEL_MAPPING_TEMP_DIR",
    os.path.join(tempfile.gettempdir(), "excel_mapping_tool"),
)
FILE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def ensure_temp_dir():
    os.makedirs(APP_TEMP_DIR, exist_ok=True)


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def path_is_in_temp_dir(path: str) -> bool:
    temp_root = os.path.realpath(APP_TEMP_DIR)
    candidate = os.path.realpath(path)
    return os.path.commonpath([temp_root, candidate]) == temp_root


def new_file_id() -> str:
    return uuid.uuid4().hex


def resolve_file(file_id: str, kind: str) -> str | None:
    if not file_id or not isinstance(file_id, str) or not FILE_ID_PATTERN.fullmatch(file_id):
        return None

    ensure_temp_dir()

    if kind == "upload":
        candidates = [
            os.path.join(APP_TEMP_DIR, f"upload_{file_id}.xlsx"),
            os.path.join(APP_TEMP_DIR, f"upload_{file_id}.xls"),
        ]
    elif kind == "output":
        candidates = [os.path.join(APP_TEMP_DIR, f"output_{file_id}.xlsx")]
    else:
        return None

    for path in candidates:
        if path_is_in_temp_dir(path) and os.path.exists(path):
            return path

    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload_excel():
    ensure_temp_dir()

    file = request.files.get("file")
    header_row = int(request.form.get("header_row", 0))
    sheet_name = request.form.get("sheet_name")

    if not file or not allowed_file(file.filename or ""):
        return jsonify({"error": "Please upload an Excel file in xls or xlsx format."}), 400

    ext = os.path.splitext(file.filename or "")[1].lower()
    file_id = new_file_id()
    upload_path = os.path.join(APP_TEMP_DIR, f"upload_{file_id}{ext}")
    file.save(upload_path)

    try:
        headers, sheets = read_excel_headers(upload_path, header_row, sheet_name)
        return jsonify({"headers": headers, "file_id": file_id, "sheets": sheets})
    except Exception as exc:
        try:
            os.remove(upload_path)
        except OSError:
            pass
        return jsonify({"error": f"Failed to parse Excel file: {exc}"}), 500


@app.route("/api/copy", methods=["POST"])
def copy_excel():
    ensure_temp_dir()

    try:
        data = request.get_json(silent=True) or {}
        source_file_id = data.get("source_file_id")
        target_file_id = data.get("target_file_id")
        mapping = data.get("mapping")
        source_header_row = data.get("source_header_row", 0)
        target_header_row = data.get("target_header_row", 0)
        mode = data.get("mode", "replace")
        source_sheet = data.get("source_sheet")
        target_sheet = data.get("target_sheet")

        if not source_file_id or not target_file_id or not mapping:
            return jsonify({"error": "Missing required parameters."}), 400

        source_path = resolve_file(source_file_id, "upload")
        target_path = resolve_file(target_file_id, "upload")

        if not source_path or not target_path:
            return jsonify({"error": "Uploaded file was not found or has expired."}), 404

        download_id = new_file_id()
        output_path = copy_excel_with_mapping(
            source_path,
            target_path,
            mapping,
            source_header_row,
            target_header_row,
            mode=mode,
            source_sheet=source_sheet,
            target_sheet=target_sheet,
            output_dir=APP_TEMP_DIR,
            output_name=f"output_{download_id}.xlsx",
        )

        return jsonify({"download_id": download_id})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/download", methods=["GET"])
def download():
    download_id = request.args.get("id")
    path = resolve_file(download_id, "output") if download_id else None

    if not path:
        return "File not found", 404

    return send_file(path, as_attachment=True, download_name="mapped.xlsx")


if __name__ == "__main__":
    ensure_temp_dir()
    app.run(debug=True, host="0.0.0.0", port=5000)

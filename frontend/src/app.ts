type Role = "source" | "target";
type CopyMode = "replace" | "append";
type Mapping = Record<number, number>;

interface UploadResponse {
    headers: string[];
    file_id: string;
    sheets: string[];
}

interface CopyResponse {
    download_id?: string;
    error?: string;
}

interface AppState {
    sourceHeaders: string[];
    targetHeaders: string[];
    sourceFileId: string;
    targetFileId: string;
    mapping: Mapping;
    selectedSource: number | null;
    selectedTarget: number | null;
    sourceFilter: string;
    targetFilter: string;
    busy: boolean;
}

const colors = ["#286f6c", "#b97816", "#6f58a8", "#2f7f44", "#b34b5c", "#3d6f9f", "#8a623b"];
const fieldRowHeight = 52;
const fieldListPadding = 24;
const minFieldListHeight = 180;
const maxFieldListHeight = 860;

const state: AppState = {
    sourceHeaders: [],
    targetHeaders: [],
    sourceFileId: "",
    targetFileId: "",
    mapping: {},
    selectedSource: null,
    selectedTarget: null,
    sourceFilter: "",
    targetFilter: "",
    busy: false,
};

const $ = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`页面缺少元素: #${id}`);
    }
    return element as T;
};

const elements = {
    sourceFile: $("sourceFile") as HTMLInputElement,
    targetFile: $("targetFile") as HTMLInputElement,
    sourceSheet: $("sourceSheet") as HTMLSelectElement,
    targetSheet: $("targetSheet") as HTMLSelectElement,
    sourceHeaderRow: $("sourceHeaderRow") as HTMLInputElement,
    targetHeaderRow: $("targetHeaderRow") as HTMLInputElement,
    sourceSearch: $("sourceSearch") as HTMLInputElement,
    targetSearch: $("targetSearch") as HTMLInputElement,
    sourceFields: $("sourceFields"),
    targetFields: $("targetFields"),
    mappingBoard: $("mappingBoard"),
    mappingSvg: $("mappingSvg") as unknown as SVGSVGElement,
    mappingList: $("mappingList"),
    sourceCount: $("sourceCount"),
    targetCount: $("targetCount"),
    mappingCount: $("mappingCount"),
    summaryText: $("summaryText"),
    workspaceHint: $("workspaceHint"),
    autoMapBtn: $("autoMapBtn") as HTMLButtonElement,
    clearBtn: $("clearBtn") as HTMLButtonElement,
    genBtn: $("genBtn") as HTMLButtonElement,
    toast: $("floatingToast"),
};

interface RoleConfig {
    fileInput: HTMLInputElement;
    sheetSelect: HTMLSelectElement;
    headerInput: HTMLInputElement;
    headers: string[];
    setHeaders(headers: string[]): void;
    setFileId(fileId: string): void;
    emptyText: string;
}

const roleConfig = {
    source: {
        fileInput: elements.sourceFile,
        sheetSelect: elements.sourceSheet,
        headerInput: elements.sourceHeaderRow,
        get headers() {
            return state.sourceHeaders;
        },
        setHeaders(headers: string[]) {
            state.sourceHeaders = headers;
        },
        setFileId(fileId: string) {
            state.sourceFileId = fileId;
        },
        emptyText: "上传源文件后显示字段",
    },
    target: {
        fileInput: elements.targetFile,
        sheetSelect: elements.targetSheet,
        headerInput: elements.targetHeaderRow,
        get headers() {
            return state.targetHeaders;
        },
        setHeaders(headers: string[]) {
            state.targetHeaders = headers;
        },
        setFileId(fileId: string) {
            state.targetFileId = fileId;
        },
        emptyText: "上传目标文件后显示字段",
    },
} satisfies Record<Role, RoleConfig>;

function toHeaderIndex(input: HTMLInputElement): number {
    const value = Number.parseInt(input.value, 10);
    return Number.isFinite(value) && value > 0 ? value - 1 : 0;
}

function normalizeHeader(value: string): string {
    return value.trim().replace(/\s+/g, "").toLowerCase();
}

function fieldLabel(header: string, index: number): string {
    const text = header.trim();
    return text || `空字段 ${index + 1}`;
}

function mappingEntries(): Array<[number, number]> {
    return Object.entries(state.mapping)
        .map(([targetIndex, sourceIndex]) => [Number(targetIndex), Number(sourceIndex)] as [number, number])
        .filter(([targetIndex, sourceIndex]) => (
            Number.isInteger(targetIndex)
            && Number.isInteger(sourceIndex)
            && targetIndex >= 0
            && sourceIndex >= 0
            && targetIndex < state.targetHeaders.length
            && sourceIndex < state.sourceHeaders.length
        ));
}

function mappingColor(index: number): string {
    return colors[index % colors.length] ?? colors[0] ?? "#286f6c";
}

function showToast(message: string, type: "success" | "warning" | "danger" = "danger"): void {
    elements.toast.textContent = message;
    elements.toast.className = `floating-toast ${type}`;
    window.setTimeout(() => elements.toast.classList.add("show"), 10);
    window.setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

async function readJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new Error(payload.error || response.statusText || "请求失败");
    }
    return payload as T;
}

async function uploadAndRender(role: Role): Promise<void> {
    const config = roleConfig[role];
    const file = config.fileInput.files?.[0];

    if (!file) {
        return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("header_row", String(toHeaderIndex(config.headerInput)));
    if (config.sheetSelect.value) {
        form.append("sheet_name", config.sheetSelect.value);
    }

    setBusy(true);

    try {
        const response = await fetch("/api/upload", {
            method: "POST",
            body: form,
        });
        const data = await readJson<UploadResponse>(response);
        config.setHeaders(data.headers);
        config.setFileId(data.file_id);
        renderSheetOptions(config.sheetSelect, data.sheets);
        pruneMapping();
        renderAll();
        showToast(`${role === "source" ? "源" : "目标"}文件解析完成`, "success");
    } catch (error) {
        showToast(error instanceof Error ? error.message : "文件解析失败");
    } finally {
        setBusy(false);
    }
}

function renderSheetOptions(select: HTMLSelectElement, sheets: string[]): void {
    const previousValue = select.value;
    select.innerHTML = "";
    sheets.forEach((sheet) => {
        const option = document.createElement("option");
        option.value = sheet;
        option.textContent = sheet;
        select.append(option);
    });
    select.disabled = sheets.length === 0;
    if (previousValue && sheets.includes(previousValue)) {
        select.value = previousValue;
    }
}

function pruneMapping(): void {
    const nextMapping: Mapping = {};
    mappingEntries().forEach(([targetIndex, sourceIndex]) => {
        nextMapping[targetIndex] = sourceIndex;
    });
    state.mapping = nextMapping;
}

function setBusy(isBusy: boolean): void {
    state.busy = isBusy;
    [
        elements.sourceFile,
        elements.targetFile,
        elements.sourceSheet,
        elements.targetSheet,
        elements.sourceHeaderRow,
        elements.targetHeaderRow,
        elements.autoMapBtn,
        elements.clearBtn,
        elements.genBtn,
    ].forEach((element) => {
        element.disabled = isBusy || (element === elements.genBtn && !canGenerate());
    });
}

function canGenerate(): boolean {
    return Boolean(state.sourceFileId && state.targetFileId && mappingEntries().length);
}

function visibleFieldCount(role: Role): number {
    const headers = role === "source" ? state.sourceHeaders : state.targetHeaders;
    const filter = role === "source" ? state.sourceFilter : state.targetFilter;
    const normalizedFilter = normalizeHeader(filter);

    if (!headers.length) {
        return 0;
    }

    if (!normalizedFilter) {
        return headers.length;
    }

    return headers.filter((header, index) => normalizeHeader(fieldLabel(header, index)).includes(normalizedFilter)).length;
}

function updateFieldListHeight(): void {
    const visibleCount = Math.max(visibleFieldCount("source"), visibleFieldCount("target"), 3);
    const desiredHeight = visibleCount * fieldRowHeight + fieldListPadding;
    const viewportLimit = Math.max(260, window.innerHeight - 360);
    const height = Math.min(Math.max(desiredHeight, minFieldListHeight), Math.min(maxFieldListHeight, viewportLimit));
    elements.mappingBoard.style.setProperty("--field-list-height", `${Math.round(height)}px`);
}

function renderAll(): void {
    updateFieldListHeight();
    renderFields("source");
    renderFields("target");
    renderMappingList();
    renderStats();
    updateFieldSelection();
    window.requestAnimationFrame(drawLines);
}

function renderStats(): void {
    const mappingCount = mappingEntries().length;
    elements.sourceCount.textContent = String(state.sourceHeaders.length);
    elements.targetCount.textContent = String(state.targetHeaders.length);
    elements.mappingCount.textContent = String(mappingCount);
    elements.genBtn.disabled = state.busy || !canGenerate();
    elements.summaryText.textContent = mappingCount ? `${mappingCount} 个字段已建立映射` : "暂无映射";

    if (!state.sourceHeaders.length || !state.targetHeaders.length) {
        elements.workspaceHint.textContent = "上传两个文件后，可拖拽或点击字段建立映射。";
    } else if (!mappingCount) {
        elements.workspaceHint.textContent = "拖拽字段，或先点击源字段再点击目标字段完成映射。";
    } else {
        elements.workspaceHint.textContent = "映射已就绪，可继续调整或生成文件。";
    }
}

function renderFields(role: Role): void {
    const headers = role === "source" ? state.sourceHeaders : state.targetHeaders;
    const container = role === "source" ? elements.sourceFields : elements.targetFields;
    const filter = role === "source" ? state.sourceFilter : state.targetFilter;
    const normalizedFilter = normalizeHeader(filter);

    container.innerHTML = "";

    if (!headers.length) {
        container.append(emptyState(roleConfig[role].emptyText));
        return;
    }

    let visibleCount = 0;
    headers.forEach((header, index) => {
        const label = fieldLabel(header, index);
        if (normalizedFilter && !normalizeHeader(label).includes(normalizedFilter)) {
            return;
        }

        visibleCount += 1;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "field-item";
        item.id = `${role}-item-${index}`;
        item.draggable = true;
        item.dataset.role = role;
        item.dataset.index = String(index);
        item.title = label;

        const indexSpan = document.createElement("span");
        indexSpan.className = "field-index";
        indexSpan.textContent = String(index + 1);

        const nameSpan = document.createElement("span");
        nameSpan.className = "field-name";
        nameSpan.textContent = label;

        item.append(indexSpan, nameSpan);
        bindFieldEvents(item, role, index);
        container.append(item);
    });

    if (!visibleCount) {
        container.append(emptyState("没有匹配的字段"));
    }
}

function emptyState(text: string): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "empty-state";
    element.textContent = text;
    return element;
}

function bindFieldEvents(item: HTMLButtonElement, role: Role, index: number): void {
    item.addEventListener("click", () => {
        if (role === "source") {
            state.selectedSource = index;
            if (state.selectedTarget !== null) {
                mapFields(index, state.selectedTarget);
            }
        } else {
            state.selectedTarget = index;
            if (state.selectedSource !== null) {
                mapFields(state.selectedSource, index);
            }
        }
        updateFieldSelection();
    });

    item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("role", role);
        event.dataTransfer?.setData("index", String(index));
        event.dataTransfer?.setData(`${role}Index`, String(index));
        event.dataTransfer?.setDragImage(item, 16, 16);
        item.classList.add("selected");
    });

    item.addEventListener("dragend", () => {
        item.classList.remove("selected");
    });

    item.addEventListener("dragover", (event) => {
        event.preventDefault();
        item.classList.add("selected");
    });

    item.addEventListener("dragleave", () => {
        item.classList.remove("selected");
    });

    item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("selected");

        const draggedRole = event.dataTransfer?.getData("role") as Role | "";
        const draggedIndex = Number(event.dataTransfer?.getData("index"));

        if (!Number.isInteger(draggedIndex) || draggedRole === role) {
            return;
        }

        if (role === "source") {
            mapFields(index, draggedIndex);
        } else {
            mapFields(draggedIndex, index);
        }
    });
}

function mapFields(sourceIndex: number, targetIndex: number): void {
    if (sourceIndex < 0 || targetIndex < 0) {
        return;
    }
    state.mapping[targetIndex] = sourceIndex;
    state.selectedSource = sourceIndex;
    state.selectedTarget = targetIndex;
    renderAll();
}

function updateFieldSelection(): void {
    document.querySelectorAll(".field-item").forEach((item) => {
        item.classList.remove("selected", "mapped");
        (item as HTMLElement).style.removeProperty("--map-color");
    });

    const sourceToColor = new Map<number, string>();
    mappingEntries().forEach(([targetIndex, sourceIndex], mappingIndex) => {
        const color = mappingColor(mappingIndex);
        sourceToColor.set(sourceIndex, color);
        applyMappedStyle(`target-item-${targetIndex}`, color);
    });

    sourceToColor.forEach((color, sourceIndex) => {
        applyMappedStyle(`source-item-${sourceIndex}`, color);
    });

    if (state.selectedSource !== null) {
        document.getElementById(`source-item-${state.selectedSource}`)?.classList.add("selected");
    }
    if (state.selectedTarget !== null) {
        document.getElementById(`target-item-${state.selectedTarget}`)?.classList.add("selected");
    }
}

function applyMappedStyle(id: string, color: string): void {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }
    element.classList.add("mapped");
    element.style.setProperty("--map-color", color);
}

function renderMappingList(): void {
    elements.mappingList.innerHTML = "";
    const entries = mappingEntries();

    if (!entries.length) {
        const item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = "还没有字段映射";
        elements.mappingList.append(item);
        return;
    }

    entries.forEach(([targetIndex, sourceIndex], index) => {
        const sourceName = fieldLabel(state.sourceHeaders[sourceIndex] ?? "", sourceIndex);
        const targetName = fieldLabel(state.targetHeaders[targetIndex] ?? "", targetIndex);
        const item = document.createElement("li");
        item.className = "mapping-item";
        item.style.setProperty("--map-color", mappingColor(index));

        const label = document.createElement("span");
        label.title = `${sourceName} -> ${targetName}`;
        label.innerHTML = `<strong>${escapeHtml(sourceName)}</strong> <span class="mapping-arrow">-></span> ${escapeHtml(targetName)}`;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-btn";
        deleteButton.textContent = "删除";
        deleteButton.addEventListener("click", () => {
            delete state.mapping[targetIndex];
            renderAll();
        });

        item.append(label, deleteButton);
        elements.mappingList.append(item);
    });
}

function escapeHtml(value: string): string {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
}

function drawLines(): void {
    const svg = elements.mappingSvg;
    svg.innerHTML = "";

    const boardRect = elements.mappingBoard.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height || window.matchMedia("(max-width: 1040px)").matches) {
        return;
    }

    svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);

    mappingEntries().forEach(([targetIndex, sourceIndex], index) => {
        const sourceItem = document.getElementById(`source-item-${sourceIndex}`);
        const targetItem = document.getElementById(`target-item-${targetIndex}`);

        if (!sourceItem || !targetItem) {
            return;
        }

        const sourceRect = sourceItem.getBoundingClientRect();
        const targetRect = targetItem.getBoundingClientRect();
        const x1 = sourceRect.right - boardRect.left + 8;
        const y1 = sourceRect.top + sourceRect.height / 2 - boardRect.top;
        const x2 = targetRect.left - boardRect.left - 8;
        const y2 = targetRect.top + targetRect.height / 2 - boardRect.top;
        const distance = Math.max(70, Math.abs(x2 - x1) * 0.45);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

        path.setAttribute("d", `M ${x1} ${y1} C ${x1 + distance} ${y1}, ${x2 - distance} ${y2}, ${x2} ${y2}`);
        path.setAttribute("stroke", mappingColor(index));
        path.setAttribute("class", "mapping-line");
        svg.append(path);
    });
}

function autoMap(): void {
    if (!state.sourceHeaders.length || !state.targetHeaders.length) {
        showToast("请先上传源文件和目标文件", "warning");
        return;
    }

    const sourceIndexByHeader = new Map<string, number>();
    state.sourceHeaders.forEach((header, index) => {
        const normalized = normalizeHeader(header);
        if (normalized && !sourceIndexByHeader.has(normalized)) {
            sourceIndexByHeader.set(normalized, index);
        }
    });

    const nextMapping: Mapping = {};
    state.targetHeaders.forEach((header, targetIndex) => {
        const sourceIndex = sourceIndexByHeader.get(normalizeHeader(header));
        if (sourceIndex !== undefined) {
            nextMapping[targetIndex] = sourceIndex;
        }
    });

    state.mapping = nextMapping;
    state.selectedSource = null;
    state.selectedTarget = null;
    renderAll();
    showToast(nextMapping && Object.keys(nextMapping).length ? "已完成自动匹配" : "没有找到同名字段", Object.keys(nextMapping).length ? "success" : "warning");
}

function clearMapping(): void {
    state.mapping = {};
    state.selectedSource = null;
    state.selectedTarget = null;
    renderAll();
}

async function generateFile(): Promise<void> {
    const entries = mappingEntries();
    if (!entries.length) {
        showToast("请先建立字段映射", "warning");
        return;
    }

    const mapping = Object.fromEntries(entries.map(([targetIndex, sourceIndex]) => [targetIndex, sourceIndex]));
    const mode = document.querySelector<HTMLInputElement>('input[name="copyMode"]:checked')?.value as CopyMode | undefined;

    setBusy(true);

    try {
        const response = await fetch("/api/copy", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source_file_id: state.sourceFileId,
                target_file_id: state.targetFileId,
                mapping,
                source_header_row: toHeaderIndex(elements.sourceHeaderRow),
                target_header_row: toHeaderIndex(elements.targetHeaderRow),
                mode: mode || "replace",
                source_sheet: elements.sourceSheet.value,
                target_sheet: elements.targetSheet.value,
            }),
        });
        const data = await readJson<CopyResponse>(response);
        if (!data.download_id) {
            throw new Error(data.error || "生成失败");
        }
        showToast("生成成功，正在下载", "success");
        window.setTimeout(() => {
            window.location.href = `/api/download?id=${encodeURIComponent(data.download_id as string)}`;
        }, 450);
    } catch (error) {
        showToast(error instanceof Error ? error.message : "生成失败");
    } finally {
        setBusy(false);
    }
}

function bindEvents(): void {
    elements.sourceFile.addEventListener("change", () => uploadAndRender("source"));
    elements.targetFile.addEventListener("change", () => uploadAndRender("target"));
    elements.sourceHeaderRow.addEventListener("change", () => uploadAndRender("source"));
    elements.targetHeaderRow.addEventListener("change", () => uploadAndRender("target"));
    elements.sourceSheet.addEventListener("change", () => uploadAndRender("source"));
    elements.targetSheet.addEventListener("change", () => uploadAndRender("target"));
    elements.sourceSearch.addEventListener("input", () => {
        state.sourceFilter = elements.sourceSearch.value;
        renderAll();
    });
    elements.targetSearch.addEventListener("input", () => {
        state.targetFilter = elements.targetSearch.value;
        renderAll();
    });
    elements.autoMapBtn.addEventListener("click", autoMap);
    elements.clearBtn.addEventListener("click", clearMapping);
    elements.genBtn.addEventListener("click", generateFile);

    [elements.sourceFields, elements.targetFields].forEach((container) => {
        container.addEventListener("scroll", () => window.requestAnimationFrame(drawLines));
    });

    window.addEventListener("resize", () => {
        updateFieldListHeight();
        window.requestAnimationFrame(drawLines);
    });
}

bindEvents();
renderAll();

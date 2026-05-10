# 电子表格字段映射工具

一个基于 Flask + TypeScript 的 Excel 字段映射工具，用于在源表和目标表之间建立字段关系，并生成新的 `.xlsx` 文件。

## 功能

- 上传源 Excel 和目标 Excel 文件
- 支持读取 `.xls` 与 `.xlsx`
- 支持选择工作表和表头行
- 拖拽或点击字段建立映射
- 自动匹配同名字段
- 支持替换和追加两种复制模式
- 生成并下载新的 Excel 文件

## 本地开发

安装 Python 依赖：

```bash
py -m pip install -r requirements.txt
```

安装前端依赖：

```bash
npm install
```

编译 TypeScript：

```bash
npm run build
```

启动 Flask：

```bash
py app.py
```

访问：

```text
http://127.0.0.1:5000
```

## 前端开发

TypeScript 源码位于 `frontend/src/app.ts`，编译后输出到 `static/js/app.js`，Flask 模板直接引用编译后的静态文件。

开发时可以使用监听模式：

```bash
npm run watch
```

## 项目结构

```text
.
├── app.py
├── excel_utils.py
├── frontend/
│   └── src/
│       └── app.ts
├── static/
│   ├── css/
│   │   └── app.css
│   └── js/
│       └── app.js
├── templates/
│   └── index.html
├── package.json
├── tsconfig.json
└── requirements.txt
```

## 注意事项

- 目标文件写入目前仅支持 `.xlsx`
- 替换模式下，目标表数据区不能包含合并单元格
- 上传文件大小限制为 20MB
- 上传、复制和下载接口只暴露随机文件 ID，不向浏览器返回服务器临时文件路径
- 生成文件只能从应用自己的临时目录中下载，不能通过 `path=` 参数读取任意路径

## Render 部署

项目已包含 `render.yaml`，可以在 Render 中使用 Blueprint 自动创建 Web Service。

部署前确认前端已编译：

```bash
npm install
npm run build
```

然后将项目推送到 GitHub。Render 控制台中选择：

```text
New -> Blueprint -> Connect GitHub repository
```

Render 会读取 `render.yaml` 并使用以下配置：

```text
Build Command: pip install -r requirements.txt
Start Command: gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120
```

为了兼容当前的文件 ID 安全机制，生产启动命令固定为 1 个 worker，并使用线程处理并发请求。

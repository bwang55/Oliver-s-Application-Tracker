# Resume Tracker

一个简历投递跟踪应用，使用 React + Vite，数据保存在本地浏览器的 localStorage。

## 启动

1. 安装依赖

```bash
npm install
```

2. 启动

```bash
npm run dev
```

## AI 使用说明

- 在右上角打开 AI 对话框。
- 填写你的 API Key / Base URL / Model。
- 输入指令，例如“把 XX 公司标记为被拒绝，并新增字段薪资范围”。
- 生成动作后点击执行。

## 数据结构

- localStorage `resumeTracker.jobs` 保存岗位数据。
- localStorage `resumeTracker.schema` 保存自定义字段列表。

# 素材与内容说明

- `images/`、`models/` 与 `models2/` 是项目原有素材，不修改原始文件。
- `public/images/hero-*-cutout.webp`：原始人物图本地抠图与压缩，作为加载时海报及图鉴；加载完后由真实模型替换。
- `public/images/hero-*.webp`、`hero-bg.webp`、`packaging.webp`：原图压缩衍生版本。原有草原插画带有 AI 生成标识。
- `public/models/*.glb`：从 `models2/` 原始模型生成，保留 UV 岛、法线、底色与材质贴图，并应用 KHR_mesh_quantization。
- `public/models/*.glb.gz`：对应 GLB 的 gzip 传输版本，可由浏览器原生解压。
- `public/favicon.svg` 与内联云纹、边饰图案：本站绘制的装饰性设计示意。
- 当前网站使用自有原生 WebGL 查看器，没有 Three.js 或 Draco 运行时依赖。sharp 和 Playwright 只用于本地素材处理与检查。
- 新增主题阅读、口头传承介绍及问答为本站导览文案；不冒充史诗原文、传承人实录或学术定本。文化术语采用一般性介绍，版本差异在页面中说明。
- 原素材发布权属以项目持有的原始授权为准。本次没有下载或新增第三方网络图片，也没有调用 AI 图片服务。

## 分级展示资源

`public/models/preview/` 是从同一批原始 GLB 生成的轻量交互版本，仅用于快速首帧。用户继续观看时自动替换为已有精细模型。轻量版本使用较少三角面、768 底色贴图及 256 法线/材质贴图；保持真实立体几何与 UV。

构建输出中的 `models/v/` 使用内容哈希命名，文件字节与对应源模型相同。哈希只用于缓存失效与版本管理，不改变模型或授权信息。

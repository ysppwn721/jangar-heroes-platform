# 三维资产处理管线 · 量化报告

生成时间：2026-03-30T09:34:00.000Z
管线版本：jiangger-asset-pipeline

本报告由 `node scripts/assetctl.mjs all` 生成。产出指标全部从 GLB 二进制头部直接解析，可复跑复现，不引用任何手写数字。

## 一、预算口径说明

| 指标 | 含义 | 约束 |
|---|---|---|
| 传输体积（gzip） | 用户实际下载量与缓存占用 | 轻量版 传输 750 KiB/个；精细版 传输 6 MiB/个；原始 10 MiB/个 |
| 原始体积（GLB） | 部署平台单文件上限 | 平台硬限 25 MiB |

两个指标分管两件事，**不能混用**：拿 gzip 体积当磁盘体积会低估，拿原始体积当传输体积会高估。

## 二、逐资产构成

| 资产 | 级别 | 原始 | gzip | 几何 | 贴图 | 顶点 | 三角面 | 索引 | 字节/顶点 | 量化 |
|---|---|---|---|---|---|---|---|---|---|---|
| `public/models/preview/alatancheji.glb` | 轻量版 | 738 KiB | 647 KiB | 525 KiB | 211 KiB | 27,726 | 29,543 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/guzangongbu.glb` | 轻量版 | 659 KiB | 580 KiB | 484 KiB | 173 KiB | 25,263 | 27,937 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/harijilagen.glb` | 轻量版 | 561 KiB | 494 KiB | 421 KiB | 138 KiB | 21,880 | 24,509 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/harinidun.glb` | 轻量版 | 639 KiB | 554 KiB | 492 KiB | 145 KiB | 26,397 | 26,828 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/hejilagen.glb` | 轻量版 | 635 KiB | 559 KiB | 497 KiB | 137 KiB | 24,764 | 31,111 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/hongguer.glb` | 轻量版 | 761 KiB | 662 KiB | 606 KiB | 154 KiB | 31,443 | 35,248 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/jiangger.glb` | 轻量版 | 580 KiB | 519 KiB | 383 KiB | 195 KiB | 19,714 | 22,617 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/mingyan.glb` | 轻量版 | 579 KiB | 511 KiB | 414 KiB | 163 KiB | 21,420 | 24,224 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/naqinshanghuer.glb` | 轻量版 | 571 KiB | 504 KiB | 387 KiB | 183 KiB | 20,271 | 22,129 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/saber.glb` | 轻量版 | 633 KiB | 546 KiB | 517 KiB | 114 KiB | 27,280 | 29,123 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/sailihantabage.glb` | 轻量版 | 516 KiB | 450 KiB | 415 KiB | 100 KiB | 21,141 | 24,958 | u16 | 13 | KHR_mesh_quantization |
| `public/models/preview/sanala.glb` | 轻量版 | 557 KiB | 485 KiB | 429 KiB | 127 KiB | 22,663 | 24,051 | u16 | 13 | KHR_mesh_quantization |
| `public/models/alatancheji.glb` | 精细版 | 5020 KiB | 3409 KiB | 3982 KiB | 1036 KiB | 135,248 | 193,270 | u32 | 13 | KHR_mesh_quantization |
| `public/models/guzangongbu.glb` | 精细版 | 4564 KiB | 3071 KiB | 3708 KiB | 854 KiB | 123,440 | 182,718 | u32 | 13 | KHR_mesh_quantization |
| `public/models/harijilagen.glb` | 精细版 | 3936 KiB | 2615 KiB | 3259 KiB | 675 KiB | 107,787 | 161,366 | u32 | 13 | KHR_mesh_quantization |
| `public/models/harinidun.glb` | 精细版 | 4378 KiB | 2918 KiB | 3668 KiB | 708 KiB | 125,537 | 177,026 | u32 | 13 | KHR_mesh_quantization |
| `public/models/hejilagen.glb` | 精细版 | 4655 KiB | 3012 KiB | 3980 KiB | 673 KiB | 126,827 | 202,248 | u32 | 13 | KHR_mesh_quantization |
| `public/models/hongguer.glb` | 精细版 | 5348 KiB | 3502 KiB | 4541 KiB | 806 KiB | 149,678 | 225,313 | u32 | 13 | KHR_mesh_quantization |
| `public/models/jiangger.glb` | 精细版 | 7000 KiB | 4943 KiB | 4996 KiB | 2002 KiB | 160,256 | 252,732 | u32 | 13 | KHR_mesh_quantization |
| `public/models/mingyan.glb` | 精细版 | 4069 KiB | 2758 KiB | 3240 KiB | 827 KiB | 108,307 | 159,137 | u32 | 13 | KHR_mesh_quantization |
| `public/models/naqinshanghuer.glb` | 精细版 | 3920 KiB | 2701 KiB | 3014 KiB | 905 KiB | 102,226 | 146,452 | u32 | 13 | KHR_mesh_quantization |
| `public/models/saber.glb` | 精细版 | 4437 KiB | 2877 KiB | 3863 KiB | 573 KiB | 129,978 | 188,805 | u32 | 13 | KHR_mesh_quantization |
| `public/models/sailihantabage.glb` | 精细版 | 3771 KiB | 2436 KiB | 3277 KiB | 492 KiB | 107,032 | 163,706 | u32 | 13 | KHR_mesh_quantization |
| `public/models/sanala.glb` | 精细版 | 3934 KiB | 2629 KiB | 3244 KiB | 689 KiB | 110,469 | 157,106 | u32 | 13 | KHR_mesh_quantization |

## 三、合计

- 资产数量：24
- 原始体积合计：**61.00 MiB**
- gzip 传输体积合计：**42.36 MiB**（压缩率 30.5%）
- 几何 49.16 MiB / 贴图 11.80 MiB
- 顶点合计 1,776,747，三角面合计 2,532,157
- GPU 贴图常驻（含 mipmap）：290.00 MiB

## 四、原始 → 产出

| 阶段 | 体积 | 相对原始 |
|---|---|---|
| 原始采集资产（models2/，仓库外） | 930.22 MiB | 100% |
| 精细版产出 | 53.74 MiB | 5.8% |
| 精细版 gzip 传输 | 36.01 MiB | 3.9% |

三角面 17,997,120 → 2,209,879（保留 12.3%）

## 五、顶点属性布局

以 `public/models/preview/alatancheji.glb` 为例：

| 属性 | 分量类型 | 归一化 | 分量数 | 字节/顶点 |
|---|---|---|---|---|
| POSITION | i16 | 是 | 3 | 6 |
| NORMAL | i8 | 否 | 3 | 3 |
| TEXCOORD_0 | u16 | 否 | 2 | 4 |

合计 **13 字节/顶点**，交错存储补齐到 **16 字节**（4 字节对齐）。

## 六、顶点缓存效率（ACMR）

| 级别 | 模型 | 顶点 | 三角面 | 索引复用比 | ACMR32 | ACMR16 |
|---|---|---|---|---|---|---|
| preview | alatancheji | 27,726 | 29,543 | 3.2 | 1.206 | 1.367 |
| preview | guzangongbu | 25,263 | 27,937 | 3.32 | 1.173 | 1.354 |
| preview | harijilagen | 21,880 | 24,509 | 3.36 | 1.156 | 1.33 |
| preview | harinidun | 26,397 | 26,828 | 3.05 | 1.256 | 1.434 |
| preview | hejilagen | 24,764 | 31,111 | 3.77 | 1.079 | 1.232 |
| preview | hongguer | 31,443 | 35,248 | 3.36 | 1.183 | 1.386 |
| preview | jiangger | 19,714 | 22,617 | 3.44 | 1.133 | 1.29 |
| preview | mingyan | 21,420 | 24,224 | 3.39 | 1.148 | 1.308 |
| preview | naqinshanghuer | 20,271 | 22,129 | 3.27 | 1.174 | 1.343 |
| preview | saber | 27,280 | 29,123 | 3.2 | 1.201 | 1.368 |
| preview | sailihantabage | 21,141 | 24,958 | 3.54 | 1.101 | 1.268 |
| preview | sanala | 22,663 | 24,051 | 3.18 | 1.193 | 1.354 |
| detail | alatancheji | 135,248 | 193,270 | 4.29 | 1.171 | 1.408 |
| detail | guzangongbu | 123,440 | 182,718 | 4.44 | 1.162 | 1.404 |
| detail | harijilagen | 107,787 | 161,366 | 4.49 | 1.13 | 1.381 |
| detail | harinidun | 125,537 | 177,026 | 4.23 | 1.22 | 1.493 |
| detail | hejilagen | 126,827 | 202,248 | 4.78 | 1.073 | 1.302 |
| detail | hongguer | 149,678 | 225,313 | 4.52 | 1.168 | 1.43 |
| detail | jiangger | 160,256 | 252,732 | 4.73 | 1.149 | 1.383 |
| detail | mingyan | 108,307 | 159,137 | 4.41 | 1.136 | 1.365 |
| detail | naqinshanghuer | 102,226 | 146,452 | 4.3 | 1.184 | 1.425 |
| detail | saber | 129,978 | 188,805 | 4.36 | 1.153 | 1.393 |
| detail | sailihantabage | 107,032 | 163,706 | 4.59 | 1.119 | 1.364 |
| detail | sanala | 110,469 | 157,106 | 4.27 | 1.149 | 1.386 |

> ACMR（Average Cache Miss Ratio）用 FIFO 顶点缓存简化模型估算，仅用于**同一批资产内部横向比较**，不代表真实驱动的绝对值。

## 七、预算与一致性断言

✓ 全部通过：传输体积、原始体积、部署平台单文件上限、索引类型、量化扩展，以及 **manifest 与实际资产一致性**。

## 八、运行时约束

| 约束 | 值 |
|---|---|
| 外部库 | 无 |
| Draco 解码器 | 不需要 |
| Three.js | 不使用 |
| CDN 依赖 | 无 |

> 网页端无任何第三方脚本或解码器下载；小程序主包 1.5 MB 上限不允许引入体积可观的第三方库。

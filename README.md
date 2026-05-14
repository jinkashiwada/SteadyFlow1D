# Steady Water Surface Lab

Steady Water Surface Lab is a browser-based educational tool for visualizing steady open-channel water-surface profiles. It is intended to help students build an intuitive understanding of backwater curves, drawdown curves, critical controls, sluice-gate flow, and hydraulic jumps.

- Japanese UI: `steady.html` or `steady-ja.html`
- English UI: `steady-en.html`

The app runs entirely in a web browser with HTML, CSS, and JavaScript. No server-side computation is required after the files are served.

## 目的

このツールは、開水路の水面形を学ぶ学生が、流量、下流端水位、河床形状、スルースゲート、堰状の支配断面を操作しながら、常流・射流・跳水・背水の関係を感覚的に理解するための教材です。

設計計算や安全照査を目的とした水理解析ソフトではありません。計算と可視化には多くの簡略化と仮定が含まれます。

## 計算モデル

計算は、矩形・単位幅水路を仮定した一次元の定常開水路流れとして扱っています。主な未知量は各流下方向メッシュの水深 `h` と水位 `eta = z + h` です。

### 支配式

連続式により、単位幅流量 `q` は流下方向に一定とします。

```text
q = u h = constant
```

運動量・エネルギーの扱いは、標準逐次法に基づく一次元水面形追跡として簡略化しています。比エネルギーは次式で評価します。

```text
E = z + h + q^2 / (2 g h^2)
```

ここで、

- `z`: 河床高
- `h`: 水深
- `q`: 単位幅流量
- `g`: 重力加速度

摩擦勾配は Manning 式を用いて近似します。

```text
Sf = n^2 q |q| / h^(10/3)
```

常流区間では下流端または支配断面から上流へ、射流区間では支配断面から下流へ水面形を追跡します。

```text
E_upstream = E_downstream + Sf dx      (subcritical profile tracking)
E_downstream = E_upstream - Sf dx      (supercritical profile tracking)
```

限界水深は矩形単位幅水路として次式で計算します。

```text
yc = (q^2 / g)^(1/3)
```

フルード数は次式です。

```text
Fr = q / (h sqrt(g h))
```

### 支配断面

河床の局所的な高まりが存在し、水面形がその断面で限界水深に近づく場合、その断面を支配断面として扱います。支配断面の上流側には常流側の水面形、下流側には射流側の水面形を追跡します。

スルースゲートでは、ゲート開度 `a` に対して、トリチェリー型の関係を用いて上流水深を近似します。

```text
h_up = a + q^2 / (2 g Cd^2 a^2)
h_jet = Cc a
```

ここで `Cd` は流量係数、`Cc` は縮流係数です。

### 跳水判定

射流区間の水深 `h1` から共役水深 `h2` を計算し、下流端水位から追跡された常流側水深 `h_tail` と比較します。

```text
h2 = 0.5 h1 ( sqrt(1 + 8 Fr1^2) - 1 )
```

分岐は次の水理量に基づいて行います。

- `h_tail < h2`: 跳水せず、射流が下流へ継続
- `h_tail = h2`: 共役水深の条件を満たす位置で接続
- 支配断面直下で `h_tail > h2`: 下流端水位が支配的な接続として表示

## 可視化

水面形、河床、スルースゲート、跳水位置、流速分布風のコンター、フルード数コンター、中立粒子を表示します。粒子は教材用の視覚表現であり、厳密なラグランジュ粒子計算ではありません。

## 重要な注意

このツールは教育用の簡略モデルです。以下の仮定と制限があります。

- 水路は矩形・単位幅として扱います。
- 流れは一次元の定常流として水面形を追跡します。
- 圧力分布、乱流、二次流、剥離、空気混入、局所損失は詳細には解いていません。
- 跳水は共役水深に基づく水理学的な判定で表示しますが、跳水内部の詳細構造は解いていません。
- 流速分布や粒子表示は、理解を助けるための模式的な可視化です。

そのため、実務設計、洪水解析、施設安全評価には使用しないでください。

## English Summary

This tool approximates steady open-channel water-surface profiles using a one-dimensional standard-step approach for a rectangular unit-width channel. It uses continuity, specific energy, Manning friction slope, critical-depth controls, a Torricelli-type sluice-gate relation, and the rectangular-channel conjugate-depth relation to judge where the supercritical branch can connect to the tailwater-controlled branch.

The visualization is designed for education. It contains intentional simplifications and should not be used for engineering design or safety-critical hydraulic analysis.

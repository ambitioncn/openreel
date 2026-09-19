export const TUTORIALS = Object.freeze([
  {
    id: "noir-trailer", version: 1, autoRun: false, title: "30 秒黑色电影预告片", category: "电影预告", level: "入门", duration: "约 20–35 分钟", calls: "2 张图 + 2 段视频", outcome: "完成一支有建立镜头、冲突和悬念收尾的 30 秒预告片。",
    nodes: [
      { type: "script", title: "三幕式预告脚本", content: "0–6 秒：雨夜城市建立镜头。6–18 秒：侦探发现关键线索。18–30 秒：追逐、黑场与片名。", x: 80, y: 100 },
      { type: "image", title: "雨夜关键帧", content: "1940 年代黑色电影，雨夜霓虹街道，孤独侦探背影，强烈明暗对比，电影构图，16:9，无文字", x: 390, y: 40 },
      { type: "image", title: "线索特写", content: "戴黑色皮手套的手拿起一张湿透的旧照片，桌灯硬光，浅景深，黑色电影质感，16:9，无文字", x: 390, y: 220 },
      { type: "video", title: "城市建立镜头", content: "镜头缓慢向前推进，雨水落下，霓虹在路面反射，侦探停下并回头，运动克制，保持人物一致", x: 720, y: 40 },
      { type: "video", title: "悬念收尾镜头", content: "从旧照片特写快速拉焦到门口的人影，灯光闪烁，人物突然抬头，最后半秒切黑，保持写实电影感", x: 720, y: 220 }
    ],
    steps: ["先阅读脚本节点，把主角、地点和谜团替换成自己的故事。", "用 Seedream 5 Lite 低成本生成两张构图草案；满意后可用 Pro 精修。", "把对应图片作为参考图，使用 Seedance 2 Fast，各生成 4–6 秒视频。", "在资产库确认结果已保存；把两段视频按建立镜头 → 线索镜头放入时间线。", "补片名卡或旁白，导出时间线清单并检查节奏。"],
    checks: ["主角服装与发型一致", "每个镜头只有一个主要动作", "提示词不要求模型生成片名文字", "先 Fast 预览，再决定是否用 Seedance 2 重做"]
  },
  {
    id: "product-commercial", version: 2, autoRun: false, title: "15 秒高级产品广告", category: "商业广告", level: "入门", duration: "约 15–25 分钟", calls: "规划 + 3 张首帧 + 3 段视频 + 配音与质量检查", outcome: "完成一支包含英雄镜头、功能细节和品牌收尾的竖屏广告。",
    nodes: [
      { type: "script", title: "三镜头广告脚本", content: "镜头 1：产品从暗处显现。镜头 2：微距展示材质与核心卖点。镜头 3：产品定格，留出后期文案区域。", x: 80, y: 120 },
      { type: "image", title: "产品英雄图", content: "一只无品牌标识的磨砂黑香水瓶，置于浅水镜面，暖金轮廓光，高级棚拍，干净背景，9:16，无文字", x: 400, y: 80 },
      { type: "video", title: "英雄揭幕", content: "产品从黑暗中缓慢显现，镜头轻微环绕，水面泛起一圈涟漪，暖金轮廓光扫过瓶身，奢华广告质感", x: 720, y: 40 },
      { type: "video", title: "材质微距", content: "微距镜头沿磨砂玻璃边缘滑动，细小水珠滚落，焦点从材质过渡到瓶盖，最后定格并在上方留白", x: 720, y: 220 },
      { type: "video", title: "最终产品定格", content: "产品保持静止，镜头锁定，灯光稳定，上方和下方留出安全空间，供后期添加品牌名、价格和行动号召，9:16，无生成文字", x: 1040, y: 130 }
    ],
    steps: ["点击“在创作向导中开始教程”；系统会在当前作品填好 15 秒产品广告示例。", "检查脚本和三个 5 秒镜头；用简单文字替换示例产品与画面。", "如需保持产品一致，上传一张有使用许可的正面参考图；系统会自动绑定全部镜头。", "保存分镜，确认总时长为 15 秒，查看网站所有者要支付的费用，再决定是否生成。", "生成完成后从头到尾播放视频，确认三个镜头都出现且没有黑屏，然后下载 MP4。"],
    checks: ["三个 5 秒镜头都出现", "产品外形和颜色保持一致", "没有黑屏或缺失镜头", "完整播放后再下载"]
  },
  {
    id: "poetry-film", version: 1, autoRun: false, title: "古诗意境水墨短片", category: "艺术短片", level: "进阶", duration: "约 25–40 分钟", calls: "2 张图 + 2 段视频", outcome: "把一首诗转成有空间层次、留白和镜头呼吸感的视觉短片。",
    nodes: [
      { type: "script", title: "诗意拆镜", content: "意象一：远山与孤舟。意象二：近岸灯火与归人。情绪弧线：清冷 → 期待 → 温暖。每个镜头只承载一个意象。", x: 80, y: 100 },
      { type: "image", title: "远山孤舟", content: "宋代水墨山水，薄雾中的层叠远山，一叶孤舟横过大面积留白水面，淡墨，宣纸肌理，16:9，无题字", x: 390, y: 40 },
      { type: "image", title: "岸边灯火", content: "水墨长卷风格，近岸茅屋一盏暖灯，远处归舟靠近，冷灰与一点暖橙对比，大面积留白，16:9，无题字", x: 390, y: 220 },
      { type: "video", title: "雾中行舟", content: "画面保持水墨笔触，雾气极慢流动，孤舟从右向左平稳移动，远山几乎静止，镜头不旋转，节奏舒缓", x: 720, y: 40 },
      { type: "video", title: "灯火归舟", content: "暖灯轻微摇曳，归舟缓慢靠岸，水面只有细小波纹，镜头缓慢推近，保持水墨留白与二维质感", x: 720, y: 220 }
    ],
    steps: ["选择一首公版古诗，只提取 2–3 个核心意象，不逐字配画。", "用 Seed 2.1 Pro 把诗拆成情绪弧线和镜头表，再精简到两个主镜头。", "用 Seedream 5 Pro 生成统一画风的起始帧；固定色彩、纸张与笔触描述。", "用 Seedance 2 生成缓慢、单一运动的视频，避免复杂摄影机运动破坏水墨感。", "字幕和诗句在后期叠加，保留画面留白；时间线用淡入淡出连接。"],
    checks: ["画风描述在所有提示词中一致", "运动幅度小而明确", "没有让模型直接生成汉字", "留白区域足够承载后期字幕"]
  },
  {
    id: "mini-documentary", version: 1, autoRun: false, title: "60 秒人物微纪录片", category: "纪录片", level: "进阶", duration: "约 35–60 分钟", calls: "1 张补画 + 2 段视频", outcome: "用真实素材与生成镜头完成一支有人物、过程和意义的微纪录片。",
    nodes: [
      { type: "script", title: "采访与结构", content: "开场问题：你每天最先做什么？过程：最难的一步是什么？结尾：为什么仍愿意坚持？结构：人物钩子 → 工作细节 → 一句价值观。", x: 80, y: 100 },
      { type: "text", title: "真实性边界", content: "真人采访和关键事实只使用真实素材；生成画面仅用于无法拍摄的过渡、环境建立或经明确标注的重现镜头。", x: 80, y: 280 },
      { type: "image", title: "环境补画", content: "清晨的传统木工工作室，窗外自然光照进木屑飞舞的空气，工具整齐摆放，无人物，写实纪录片摄影，16:9", x: 420, y: 80 },
      { type: "video", title: "清晨建立镜头", content: "固定机位，清晨光线逐渐照亮工作台，空气中的木屑轻微漂浮，真实纪录片质感，不出现人物，不添加不存在的事件", x: 730, y: 80 },
      { type: "video", title: "工艺细节重现", content: "手部打磨木料的近景，动作缓慢准确，木屑自然落下，手持纪录片镜头轻微呼吸感，不展示脸部或可识别身份", x: 730, y: 250 }
    ],
    steps: ["先上传真实采访、工作过程和环境声；把事实与生成重现内容分开管理。", "用脚本节点整理 60 秒结构：前 5 秒人物钩子，中段过程，最后一句价值观。", "缺少环境建立镜头时，用 Seedream 5 Pro 与 Seedance 2 Fast 补一个不改变事实的过渡镜头。", "生成重现画面避免可识别真人脸部，并在成片中按需要标注“情景重现”。", "时间线优先保留真实同期声；生成镜头作为 B-roll 覆盖剪辑点，最后导出检查事实与授权。"],
    checks: ["受访者和素材授权已确认", "生成内容不虚构关键事实", "可识别人物不被擅自克隆", "真实素材与生成素材在资产库中可区分"]
  },
  {
    id: "character-dialogue", version: 1, autoRun: false, title: "双人角色一致性对话", category: "角色短剧", level: "进阶", duration: "约 25–40 分钟", calls: "2 张角色图 + 2 段视频", outcome: "完成一组服装、空间关系和视线方向连续的双人对话镜头。",
    nodes: [
      { type: "script", title: "正反打连续性表", content: "角色甲始终在画面左侧、深蓝外套；角色乙始终在右侧、米色衬衫。镜头一甲提问，镜头二乙回答，保持轴线与光向。", x: 80, y: 100 },
      { type: "image", title: "角色甲参考", content: "三十岁短发女性，深蓝外套，咖啡馆窗边，胸像，柔和侧光，中性表情，16:9，无文字", x: 390, y: 40 },
      { type: "image", title: "角色乙参考", content: "三十五岁卷发男性，米色衬衫，同一咖啡馆窗边，胸像，柔和侧光，中性表情，16:9，无文字", x: 390, y: 220 },
      { type: "video", title: "角色甲提问", content: "角色甲位于画面左侧看向右侧，轻声提问后停顿，保持深蓝外套、发型和咖啡馆背景不变，固定机位", x: 720, y: 40 },
      { type: "video", title: "角色乙回答", content: "角色乙位于画面右侧看向左侧，先思考再回答，保持米色衬衫、发型、背景和光向不变，固定机位", x: 720, y: 220 }
    ],
    steps: ["分别上传或创建角色甲、乙的干净参考图。", "在脚本节点锁定服装、左右站位、视线和主光方向。", "逐镜头只改变表情和一个主要动作，生成前复核引用的角色图。", "并排检查两段结果，出现身份或服装漂移时只重做对应镜头。", "按提问 → 回答放入时间线，并检查视线方向没有跳轴。"],
    checks: ["角色身份与服装跨镜头一致", "左右站位和视线方向连续", "每个镜头只有一个主要动作", "失败镜头可单独重做"]
  },
  {
    id: "storyboard-animatic", version: 1, autoRun: false, title: "分镜到动态预演", category: "分镜预演", level: "入门", duration: "约 20–30 分钟", calls: "3 张分镜图 + 3 段预演", outcome: "把三拍故事转换为顺序明确、可逐镜头替换的动态预演。",
    nodes: [
      { type: "script", title: "三拍镜头表", content: "镜头一：远景建立地点。镜头二：中景展示行动。镜头三：特写揭示结果。每镜头记录景别、动作和预计时长。", x: 80, y: 100 },
      { type: "image", title: "建立镜头分镜", content: "海边灯塔清晨远景，巡守员沿小路走近，电影分镜草图，16:9，无文字", x: 390, y: 20 },
      { type: "image", title: "行动镜头分镜", content: "巡守员推开灯塔旧木门，中景，电影分镜草图，保持人物服装和空间方向，16:9，无文字", x: 390, y: 180 },
      { type: "image", title: "结果镜头分镜", content: "熄灭的灯塔灯罩中出现微弱光点，特写，电影分镜草图，16:9，无文字", x: 390, y: 340 },
      { type: "video", title: "三镜头预演", content: "按远景建立、中景推门、灯罩特写的顺序制作低成本动态预演；每镜头单一运动并保留替换边界", x: 740, y: 170 }
    ],
    steps: ["先在镜头表写清三拍故事与每镜头时长。", "用统一画风和角色描述生成三张分镜草图。", "逐张检查空间方向，再分别制作低成本短预演。", "按编号顺序加入时间线，不满意时只替换单个镜头。", "导出前核对镜头顺序、总时长和替换记录。"],
    checks: ["镜头顺序与脚本一致", "角色和空间方向连续", "每个镜头可独立替换", "预演不自动触发高成本精修"]
  },
  {
    id: "music-visualizer", version: 1, autoRun: false, title: "音乐节拍视觉短片", category: "音乐视觉", level: "进阶", duration: "约 25–45 分钟", calls: "2 张视觉图 + 2 段视频", outcome: "围绕已授权音乐的节拍点制作可对齐时间线的循环视觉。",
    nodes: [
      { type: "audio", title: "授权音乐与节拍点", content: "上传已授权音乐，记录 0、4、8、12 秒的主要节拍点；不要上传无权使用的商业录音。", x: 80, y: 100 },
      { type: "image", title: "冷色主视觉", content: "抽象玻璃波纹与深蓝粒子，中心构图，高对比舞台光，16:9，无文字", x: 390, y: 40 },
      { type: "image", title: "暖色高潮视觉", content: "抽象玻璃波纹转为金橙粒子爆发，保持相同中心构图和材质，16:9，无文字", x: 390, y: 220 },
      { type: "video", title: "主歌循环", content: "深蓝粒子随缓慢脉冲扩散，首尾构图一致以便循环，镜头固定，四秒", x: 720, y: 40 },
      { type: "video", title: "高潮转场", content: "在强拍处由深蓝快速过渡到金橙粒子爆发，随后稳定，保持玻璃波纹材质，四秒", x: 720, y: 220 }
    ],
    steps: ["确认音乐授权并上传音频，记录主要节拍点。", "生成冷暖两张构图一致的主视觉。", "分别制作可循环主歌段和一次性高潮转场。", "在时间线把视觉切点吸附到记录的节拍时间。", "导出后检查音画同步、循环接缝和音频是否保留。"],
    checks: ["音乐使用权已确认", "切点与节拍时间一致", "循环首尾没有明显跳变", "导出保留音频轨道"]
  },
  {
    id: "social-reframe", version: 1, autoRun: false, title: "横版素材竖屏重构", category: "社媒改编", level: "入门", duration: "约 15–25 分钟", calls: "1 张构图稿 + 2 段视频", outcome: "把横版故事重构为主体安全、字幕留白明确的竖屏短视频。",
    nodes: [
      { type: "script", title: "竖屏安全区", content: "前两秒展示主体和钩子；人物保持在中间安全区；顶部和底部为标题、字幕、平台控件留白；总长 15 秒。", x: 80, y: 100 },
      { type: "image", title: "9:16 构图稿", content: "城市屋顶上的年轻摄影师，主体位于竖屏中部，顶部天空和底部地面留白，电影光线，9:16，无文字", x: 400, y: 80 },
      { type: "video", title: "开场钩子", content: "摄影师快速举起相机看向远方，镜头轻推，主体始终位于竖屏中部安全区，9:16，三秒", x: 720, y: 40 },
      { type: "video", title: "结果揭示", content: "从摄影师肩后推向城市日出，保留顶部标题区和底部字幕区，运动平稳，9:16，六秒", x: 720, y: 220 }
    ],
    steps: ["从横版素材中选出一个两秒内可理解的动作钩子。", "先用构图稿确认人物和产品都在竖屏安全区。", "分别生成钩子与结果镜头，明确 9:16 和留白位置。", "在时间线控制总长并为字幕保留阅读时间。", "分别预览无 UI 和平台遮罩效果，再导出竖屏版本。"],
    checks: ["主体没有被竖屏裁切", "顶部和底部留白足够", "前两秒能理解核心动作", "文字只在后期叠加"]
  }
]);

export const tutorialById = id => TUTORIALS.find(tutorial => tutorial.id === id) || null;
export const validateTutorial = tutorial => Boolean(tutorial?.id && Number.isSafeInteger(tutorial?.version) && tutorial.version > 0 && tutorial?.autoRun === false && tutorial?.title && tutorial?.outcome && tutorial.nodes?.length >= 3 && tutorial.steps?.length >= 4 && tutorial.checks?.length >= 3 && tutorial.nodes.every(node => ["text", "image", "video", "audio", "script"].includes(node.type) && node.title && node.content && Number.isFinite(node.x) && Number.isFinite(node.y)));

export function tutorialWorkflow(id) {
  const tutorial = tutorialById(id);
  if (!tutorial || !validateTutorial(tutorial)) throw new TypeError("valid tutorial is required");
  return Object.freeze({
    schema: "openreel-workflow/v1",
    template: `tutorial:${tutorial.id}`,
    version: tutorial.version,
    autoRun: false,
    nodes: tutorial.nodes.map((node, index) => Object.freeze({ id: `${tutorial.id}:${index + 1}`, type: node.type, title: node.title, content: node.content, position: Object.freeze({ x: node.x, y: node.y }) }))
  });
}

export function tutorialProgress(id, completedSteps = []) {
  const tutorial = tutorialById(id);
  if (!tutorial || !Array.isArray(completedSteps) || completedSteps.some(step => !Number.isSafeInteger(step) || step < 0 || step >= tutorial.steps.length)) throw new TypeError("valid tutorial and completed step indexes are required");
  const completed = [...new Set(completedSteps)].sort((a, b) => a - b), nextStep = Array.from({ length: tutorial.steps.length }, (_, index) => index).find(index => !completed.includes(index));
  return Object.freeze({ schema: "openreel-tutorial-progress/v1", tutorialId: tutorial.id, tutorialVersion: tutorial.version, autoRun: false, completedSteps: completed, completedCount: completed.length, totalSteps: tutorial.steps.length, status: completed.length === tutorial.steps.length ? "completed" : completed.length ? "in_progress" : "not_started", nextStep: nextStep ?? null });
}

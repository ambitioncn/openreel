const STORAGE_KEY = "openreel.locale";
const SUPPORTED = new Set(["en", "zh-CN"]);

const pairs = [
  ["创建独立新作品", "Create a separate project"], ["我确认在当前作品中创建这个视频", "I confirm this video belongs in the current project"], ["新账号默认继续“我的第一个视频”，这样教程、素材和成片不会分散到不同作品。", "New accounts continue in “My first video” by default, so the tutorial, assets, and final video stay together."],
  ["声音与字幕", "Voice and captions"], ["高级音频、文字卡与授权", "Advanced audio, text cards, and permissions"], ["只有添加音乐或自定义文字卡时才需要这里的设置。上传音乐前请让成年人确认你有权使用它。", "You only need these settings for music or custom text cards. Ask an adult to confirm you may use any uploaded music."], ["生成背景音乐", "Generate background music"], ["我和成年人已确认可以使用这段音乐", "An adult and I confirmed we may use this music"],
  ["生成准备", "Generation readiness"], ["我们会告诉你下一步", "We’ll tell you what to do next"], ["先保存三个镜头，再查看费用。", "Save the three shots, then see the cost."], ["高级质量细节（可选）", "Advanced quality details (optional)"], ["等待生成", "Waiting to generate"], ["生成完成后会自动检查画面质量。", "Picture quality is checked automatically after generation."], ["查看费用", "See cost"], ["这是网站所有者要支付的估算费用。勾选确认前不会花钱。", "This is the site owner's estimated cost. Nothing is spent until you check the confirmation."], ["是的，现在制作视频（会花费上面显示的金额）", "Yes, make my video now (this spends the amount shown above)"], ["制作我的视频", "Make my video"], ["再试一次", "Try again"], ["只重做失败镜头", "Redo only failed shots"], ["我确认重做费用", "I confirm the redo cost"],
  ["发布（可选）", "Publishing (optional)"], ["下载 MP4 就已经完成", "Downloading the MP4 means you’re done"], ["不想发布到网络？点击上面的“下载 MP4 成片”即可。连接账号只用于直接发布，需要成年人完成官方授权。", "Don’t want to post online? Just choose “Download final MP4” above. Connecting an account is only for direct publishing and requires an adult to complete official authorization."], ["可连接的平台", "Platforms you can connect"], ["检查发布设置", "Check publishing settings"], ["发布是可选的；下载视频不需要连接任何账号。", "Publishing is optional; downloading your video does not require any connected account."],
  ["高级生成质量设置", "Advanced generation quality settings"], ["向导导航", "Wizard navigation"], ["← 上一步", "← Back"], ["下一步 →", "Next →"], ["第 1 步，共 5 步", "Step 1 of 5"],
  ["在创作向导中开始教程", "Start this tutorial in Create"], ["可选：上传一张参考图（会自动绑定全部镜头）", "Optional: upload one reference image (it will bind to every shot)"], ["检查结果", "Check your result"], ["高级画布模板（可选）", "Advanced Canvas templates (optional)"],
  ["语言", "Language"],
  ["创作", "Create"], ["工作区", "Workspace"], ["项目", "Project"], ["账号", "Account"],
  ["首页", "Home"], ["作品工作台", "Creator Workspace"], ["高级画布", "Advanced Canvas"], ["教程", "Tutorials"], ["反馈", "Feedback"], ["作品", "Projects"], ["平台连接", "Connections"],
  ["项目库", "PROJECT LIBRARY"], ["返回首页", "Back to home"], ["打开、重命名、归档、删除或新建作品，无需离开作品库。", "Open, rename, archive, delete, or create a project without leaving your library."],
  ["账号连接", "ACCOUNT CONNECTIONS"], ["平台连接管理", "Platform connections"], ["把官方发布账号连接与创作项目分开管理。", "Manage official publishing account connections separately from your creative projects."],
  ["创作者工作区", "CREATOR WORKSPACE"], ["从创意、脚本、分镜、生成一路完成一个项目直到成片。", "Develop one project from idea through script, storyboard, generation, and final cut."],
  ["粘贴已有文案", "Paste existing script"], ["选择创意、粘贴已有脚本、添加商品链接或上传参考素材。", "Choose an idea, paste an existing script, add a product URL, or upload a reference asset."],
  ["高级画布快速指南", "Advanced Canvas quick guide"], ["从工具箱添加节点。", "Add a node from the toolbox."], ["选择节点；按住 Shift 可多选。", "Select nodes; Shift-click selects more than one."], ["连接、分组、编辑或删除所选节点。", "Connect, group, edit, or delete the selection."], ["删除所选节点", "Delete selected node"],
  ["选择一个引导案例。教程会创建可审阅的画布蓝图，绝不会自动运行付费模型。", "Choose a guided example. Tutorials create reviewable canvas blueprints and never run paid models automatically."],
  ["使用方法", "HOW IT WORKS"], ["四步使用教程", "Use a tutorial in four steps"],
  ["选择教程", "Choose a tutorial"], ["选择符合目标的类型，并先阅读预期成果。", "Pick the format that matches your goal and review its outcome."],
  ["按清单操作", "Follow the checklist"], ["逐项完成引导步骤，刷新后仍会保留进度。", "Complete each guided step and keep your progress across refreshes."],
  ["审阅蓝图", "Review the blueprint"], ["把蓝图加入画布，再检查提示词、模型和限制。", "Add the blueprint to the canvas, then inspect prompts, models, and limits."],
  ["准备好后再生成", "Generate only when ready"], ["自行运行已批准节点；教程绝不会启动付费生成。", "Run approved nodes yourself; tutorials never start paid generation."],
  ["用六个清晰步骤制作视频", "Make a video in six clear steps"], ["清单只记录你的进度，不会执行或验证工作。", "The checklist records your progress; it does not perform or verify the work."], ["使用每个操作按钮打开真正完成工作的准确位置。", "Use each action button to open the exact place where the work happens."],
  ["用五个清晰步骤制作视频", "Make a video in five clear steps"], ["新手教程始终在创作向导中完成。", "The beginner tutorial stays in Create."], ["高级画布是可选的，绝不是必需步骤。", "Advanced Canvas is optional and never required."], ["打开创作向导", "Open guided Create"], ["正确的时长和示例会自动填好。", "The correct duration and example are filled in for you."], ["检查三个镜头", "Review the three shots"], ["编辑简单的台词和画面描述。", "Edit simple dialogue and picture descriptions."], ["上传并制作", "Upload and make"], ["上传一次即可把参考图绑定到全部镜头；花钱前会先看到费用。", "One upload can bind a reference to every shot; review the cost before spending."], ["观看并下载", "Watch and download"], ["完整播放合格 MP4，然后下载。", "Play the whole qualified MP4, then download it."],
  ["阅读结果并检查当前作品名称。", "Read the result and check the current project name."], ["只添加一次蓝图", "Add the blueprint once"], ["这会创建可编辑画布节点，不会生成媒体或消耗额度。", "This creates editable Canvas nodes. It does not generate media or spend allowance."], ["修改示例", "Edit the examples"], ["选择每个节点，在内容中替换示例产品或故事。", "Select each node and replace the sample product or story in Content."], ["继续到创作工作台", "Continue in Create"], ["在同一作品中打开已自动填入的教程方案。", "Open the same project with the tutorial plan already filled in."], ["上传并生成", "Upload and generate"], ["绑定可选参考图，查看报价，再明确确认任何付费生成。", "Bind an optional reference, review the quote, then explicitly confirm any paid generation."], ["检查并下载", "Review and download"], ["预览合格 MP4 并点击下载最终 MP4。", "Preview the qualified MP4 and use Download final MP4."],
  ["我的作品", "My projects"], ["作品与草稿", "Projects and drafts"], ["新建作品", "New project"], ["作品名称", "Project name"],
  ["例如：咖啡小技巧", "For example: Better coffee tips"], ["创建空白草稿", "Create blank draft"], ["取消", "Cancel"],
  ["正在加载作品…", "Loading projects…"], ["OPENREEL 短视频工作台", "OPENREEL SHORT VIDEO WORKSPACE"],
  ["一个想法，变成可以发布的短视频", "Turn one idea into a publishable short video"],
  ["不用学习节点和模型。告诉我们你想做什么，OpenReel 会带你完成脚本、分镜、画面、配音、字幕和成片。", "No nodes or models to learn. Tell OpenReel what you want to make and it will guide you through the script, storyboard, visuals, voice-over, captions, and final cut."],
  ["发布账号", "Publishing accounts"], ["连接发布平台", "Connect publishing platforms"],
  ["先绑定发布账号，之后可在任意作品的成片步骤选择。无需先创建脚本或成片。", "Connect an account now, then select it from the final-cut step of any project. No script or finished video is required."],
  ["正在检查账号状态…", "Checking account status…"], ["连接账号", "Connect account"],
  ["连接账号只会启动平台官方授权，不会发布任何内容。", "Connecting starts the platform's official authorization flow and never publishes content."],
  ["推荐", "Recommended"], ["TikTok / 抖音 竖屏短视频", "TikTok / Douyin vertical short video"],
  ["30–60 秒 · 9:16 · 自动 Hook、字幕、配音与 B-roll", "30–60 sec · 9:16 · Automatic hook, captions, voice-over, and B-roll"], ["开始创作", "Start creating"],
  ["创作步骤", "Creation steps"], ["1 创意", "1 Idea"], ["2 脚本", "2 Script"], ["3 分镜", "3 Storyboard"], ["4 生成", "4 Generate"], ["5 成片", "5 Final cut"],
  ["第 1 步 · 告诉我们你要做什么", "Step 1 · Tell us what you want to make"], ["描述你的短视频", "Describe your short video"],
  ["一句话、商品卖点、知识主题或网页内容都可以。", "Start with one sentence, product benefits, a topic, or a web page."],
  ["保存到哪个作品？", "Which project should this use?"], ["创建独立新作品（推荐）", "Create a separate project (recommended)"], ["继续当前作品", "Continue the current project"],
  ["我确认用这个新创意改写当前作品", "I confirm this idea may rewrite the current project"],
  ["选择新作品不会覆盖当前脚本、分镜或素材。继续当前作品必须在本次提交前明确确认。", "A new project will not overwrite the current script, storyboard, or assets. Continuing the current project requires explicit confirmation."],
  ["已创建独立作品", "Created a separate project"], ["已确认继续当前作品", "Confirmed continuing the current project"],
  ["从哪里开始？", "Where do you want to start?"], ["一句话", "An idea"], ["文案", "Copy"], ["商品链接", "Product URL"], ["上传素材", "Upload an asset"],
  ["视频主题", "Video topic"], ["例如：用轻松有趣的方式，介绍三种让咖啡更好喝的小技巧", "For example: Share three fun, simple ways to make better coffee"],
  ["参考素材", "Reference asset"], ["素材通过现有安全上传链路保存到当前作品，不会自动调用模型。", "The asset is stored in the current project through the secure upload path. No model runs automatically."],
  ["作品类型", "Project type"], ["知识分享", "Educational"], ["商品种草", "Product showcase"], ["故事叙述", "Story"], ["口播观点", "Talking head"], ["资讯解读", "News explainer"],
  ["目标时长", "Target duration"], ["约 5 秒", "About 5 seconds"], ["约 15 秒", "About 15 seconds"], ["约 30 秒", "About 30 seconds"], ["约 60 秒", "About 60 seconds"],
  ["生成脚本与分镜", "Create script and storyboard"], ["此步骤只创建可审阅的创作方案，不会调用付费模型。", "This step only creates a reviewable plan and will not call paid models."], ["此步骤会使用已配置的规划模型，并可能记录模型用量。你会在任何媒体生成前先审查脚本和分镜。", "This step uses the configured planning model and may record model usage. You will review the script and storyboard before any media generation."],
  ["第 2 步 · 脚本", "Step 2 · Script"], ["选择 Hook，打磨完整脚本", "Choose a hook and refine the full script"], ["自动保存到当前作品", "Saved automatically to this project"], ["3 个开场 Hook", "3 opening hooks"], ["完整口播脚本", "Full voice-over script"],
  ["第 3 步 · 分镜", "Step 3 · Storyboard"], ["逐镜调整台词、画面和时长", "Refine dialogue, visuals, and timing shot by shot"], ["总时长", "Total duration"],
  ["生成前检查", "Pre-generation review"], ["简化时间线", "Simple timeline"], ["正在估算…", "Estimating…"], ["成本为生成前估算，确认生成前不会产生付费调用。", "Costs are estimates. No paid call occurs before confirmation."],
  ["声音、字幕与平台安全区", "Audio, captions, and platform safe areas"], ["配音风格", "Voice style"], ["自然", "Natural"], ["活力", "Energetic"], ["沉稳", "Calm"],
  ["背景音乐", "Background music"], ["无音乐", "No music"], ["轻柔", "Light"], ["动感", "Upbeat"], ["使用 SeedAudio 1.0 生成背景音乐（服务默认禁用）", "Generate background music with SeedAudio 1.0 (disabled by default)"],
  ["音乐提示词", "Music prompt"], ["轻快、无歌词的海滩舞蹈配乐", "Upbeat instrumental beach dance music"], ["音乐时长", "Music duration"], ["上传字幕卡（PNG）", "Upload caption card (PNG)"],
  ["字幕对应镜头", "Caption shot"], ["字幕文字", "Caption text"], ["上传背景音乐（WAV/MP3）", "Upload background music (WAV/MP3)"], ["音乐来源声明", "Music source declaration"],
  ["例如：本人创作或已取得许可", "For example: Original work or licensed"], ["上传后将绑定当前分镜版本并标记为已审核。", "Uploads are bound to the current storyboard version and marked reviewed."],
  ["已审核音乐素材", "Reviewed music asset"], ["不使用素材库音乐", "Do not use library music"],
  ["我确认已取得所需音乐权利，并自行承担上传、生成、使用与发布责任；OpenReel 不替我判定授权状态。", "I confirm I hold the required music rights and accept responsibility for uploading, generating, using, and publishing it. OpenReel does not determine licensing status for me."],
  ["字幕卡素材", "Caption-card assets"], ["安全区", "Safe area"], ["自动字幕", "Automatic captions"], ["保存脚本与分镜", "Save script and storyboard"], ["可添加、删除、复制和排序镜头；保存不会调用付费模型。", "You can add, delete, duplicate, and reorder shots. Saving does not call paid models."], ["从每个镜头文字创建文字卡", "Create text cards from every shot’s text"], ["产品广告可把品牌、价格和 CTA 写入最终镜头文字；保存分镜后再创建文字卡。文字会在安全区内烧录到导出视频。", "For a product ad, put the brand, price, and CTA in the final shot’s text, save the storyboard, then create the cards. The text is burned into the exported video inside the safe area."],
  ["TikTok / 抖音", "TikTok / Douyin"], ["阶段", "Stage"], ["发布资格", "Publishing eligibility"], ["禁止", "Blocked"],
  ["尚未绑定账号", "Account not connected"], ["已连接，但暂无发布权限", "Connected, but publishing permission is unavailable"],
  ["尚无具备发布权限的绑定账号；不会自动授权或对外发布。", "No connected account currently has publishing permission. Nothing will be authorized or published automatically."],
  ["还没有可导出的时间线；此状态不会启动生成或付费调用。", "There is no exportable timeline yet. This state will not start generation or any paid call."],
  ["快速模式已就绪，生成时将自动选择合适模型。", "Fast mode is ready. OpenReel will automatically choose suitable models when generation starts."],
  ["当前作品还没有素材，可从上方安全上传。", "This project has no assets yet. Upload one safely above."],
  ["开场 Hook", "Opening hook"], ["核心内容", "Core content"], ["结尾行动", "Closing action"],
  ["证据", "Evidence"], ["门禁", "Gate"], ["费用上限", "Cost limit"], ["重试", "Retries"], ["未设置", "not set"],
  ["所有内容都可以修改；保存不会调用付费模型。", "Everything remains editable. Saving does not call paid models."],
  ["第 4 步 · 生成", "Step 4 · Generate"], ["费用预检、确认与生成进度", "Cost review, confirmation, and generation progress"], ["确认前不会调用付费模型", "No paid model is called before confirmation"],
  ["保存最新脚本与分镜后获取费用预检。", "Save the latest script and storyboard to get a cost estimate."], ["商业安全与参考图证据", "Commercial safety and reference evidence"],
  ["生成输入模式", "Generation input mode"], ["纯文字生成（默认）", "Text to video (default)"], ["使用参考图保持人物/商品一致性", "Use a reference image for person/product consistency"],
  ["无需上传图片。系统会根据每个分镜的文字描述生成首帧，再生成视频。", "No image is required. OpenReel creates a first frame from each storyboard prompt, then generates the video."],
  ["选择参考图模式后，请上传并绑定一张图片。", "When using reference-image mode, upload and bind an image."],
  ["人物/物体参考图", "Person/object reference image"], ["选择分镜已绑定的参考图", "Select a reference image bound to the storyboard"], ["主体类型", "Subject type"], ["虚构成人", "Fictional adult"], ["纯物体", "Object only"],
  ["请先上传一张图片，并把它绑定到至少一个分镜；完成前无法获取费用预检。", "Upload an image and bind it to at least one storyboard shot before requesting a cost estimate."], ["去上传并绑定参考图", "Upload and bind a reference image"],
  ["我确认拥有或已取得该参考图的使用许可", "I confirm I own or have permission to use this reference image"], ["我确认素材与要求不含未经许可的品牌", "I confirm the assets and request contain no unlicensed brands"], ["我确认素材与要求不含公众人物", "I confirm the assets and request contain no public figures"],
  ["报价时会读取所选图片的真实字节，核验实际尺寸并计算 SHA-256；不会产生模型费用。", "The quote reads the selected image bytes, verifies its dimensions, and calculates SHA-256 without incurring model costs."],
  ["参考图模式会读取所选图片的真实字节，核验实际尺寸并计算 SHA-256；不会产生模型费用。", "Reference-image mode reads the selected image bytes, verifies its dimensions, and calculates SHA-256 without incurring model costs."],
  ["导演质量责任", "Director quality responsibility"], ["生成与合格状态分离", "Generation and qualification are separate"], ["实际视频感知证据", "Perceptual evidence from actual video"], ["未通过", "Not passed"], ["通过", "Passed"],
  ["人物视觉身份一致性 / 表演自然度", "Visual identity consistency / performance naturalness"], ["等待实际视频字节质量评估", "Waiting for quality evaluation of actual video bytes"],
  ["获取费用预检", "Get cost estimate"], ["我确认按当前报价与版本开始真实生成", "I confirm real generation at the current quote and version"], ["确认并开始生成", "Confirm and generate"], ["重试失败任务", "Retry failed jobs"], ["仅重做失败镜头", "Redo failed shots only"], ["我确认按单镜头报价创建重做任务", "I confirm the per-shot quote and redo job"], ["确认重做", "Confirm redo"], ["取消未开始任务", "Cancel unstarted jobs"], ["尚未创建生成任务。", "No generation job has been created."],
  ["第 5 步 · 成片", "Step 5 · Final cut"], ["预览、导出与发布文案", "Preview, export, and publishing copy"], ["导出前需确认时间线", "Review the timeline before export"],
  ["尚无成片。生成镜头并加入时间线后即可预览和导出。", "No final cut yet. Generate shots and add them to the timeline to preview and export."], ["作品标题", "Project title"], ["发布文案", "Publishing copy"], ["保存标题与文案", "Save title and copy"], ["作品标题和发布文案是平台说明文字，不会烧录到视频中。", "Project title and publishing copy are platform description text. They are not burned into the video."],
  ["我已检查时间线与成片内容", "I reviewed the timeline and final cut"], ["导出 MP4", "Export MP4"], ["下载 MP4 成片", "Download final MP4"], ["一键发布", "One-click publishing"],
  ["选择已绑定账号与目标平台", "Choose connected accounts and platforms"], ["发布前逐平台校验并再次最终确认；单个平台失败不会隐藏其他平台结果。", "Each platform is validated before a final confirmation. One platform failure never hides the others."],
  ["发布目标", "Publishing destinations"], ["未绑定账号", "Account not connected"], ["校验并进入最终确认", "Validate and continue to final confirmation"], ["恢复最近批次", "Recover latest batch"], ["最终确认并发布", "Final confirmation and publish"], ["逐平台发布状态", "Per-platform publishing status"],
  ["绑定账号后可用；此处不会自动授权或对外发布。", "Available after connecting an account. Nothing is authorized or published automatically."], ["导出使用本地预览渲染，不会调用付费模型。", "Export uses local preview rendering and does not call paid models."],
  ["自动模型路由", "Automatic model routing"], ["选择生成偏好", "Choose a generation preference"], ["无需选择具体模型", "No individual model selection needed"], ["OpenReel 会按画面、视频和声音任务自动匹配模型", "OpenReel automatically matches models to image, video, and audio tasks"],
  ["快速", "Fast"], ["优先速度与低成本，适合草稿和试做", "Prioritizes speed and lower cost for drafts and experiments"], ["高质量", "High quality"], ["优先成片质量，适合最终生成", "Prioritizes final quality for production renders"], ["正在检查可用生成能力…", "Checking available generation capabilities…"],
  ["作品素材", "Project assets"], ["素材库", "Asset library"], ["筛选", "Filter"], ["全部", "All"], ["图片", "Images"], ["视频", "Videos"], ["音频", "Audio"], ["绑定到分镜", "Bind to storyboard"], ["先创建分镜", "Create a storyboard first"], ["绑定选中素材", "Bind selected asset"], ["正在加载素材…", "Loading assets…"],
  ["更多工作流", "More workflows"], ["你想制作哪种作品？", "What would you like to create?"], ["即将开放", "Coming soon"], ["商品种草视频", "Product showcase"], ["从商品卖点生成 Hook、口播和场景化素材。", "Turn product benefits into a hook, voice-over, and contextual visuals."], ["知识分享视频", "Educational video"], ["把复杂主题讲成清晰、有节奏的竖屏短片。", "Explain a complex topic in a clear, well-paced vertical video."], ["观点口播视频", "Talking-head opinion"], ["优化表达结构，自动匹配字幕与辅助画面。", "Refine the narrative and automatically match captions and supporting visuals."], ["故事短片", "Short story"], ["从故事梗概生成分镜、角色和连续镜头。", "Turn a synopsis into a storyboard, characters, and continuous shots."],
  ["从经典类型开始创作", "Start with a classic format"], ["选择一个案例，把完整节点蓝图放到当前画布。教程不会自动调用付费模型。", "Choose an example and place its complete node blueprint on the canvas. Tutorials never call paid models automatically."],
  ["告诉我们哪里需要改进", "Tell us what we can improve"], ["类别", "Category"], ["生成", "Generation"], ["编辑", "Editing"], ["导出", "Export"], ["发布", "Publishing"], ["稳定性", "Reliability"], ["其他", "Other"], ["评分", "Rating"], ["很满意", "Very satisfied"], ["很不满意", "Very dissatisfied"], ["补充说明", "Additional details"], ["提交反馈", "Submit feedback"],
  ["已归档", "Archived"], ["空白草稿", "Blank draft"], ["脚本草稿", "Script draft"], ["镜 · 编辑中", "shots · Editing"], ["重命名", "Rename"], ["更新于", "Updated"], ["恢复", "Restore"], ["归档", "Archive"], ["删除", "Delete"], ["共", "Total"], ["个作品", "projects"], ["还没有作品，创建第一个空白草稿。", "No projects yet. Create your first blank draft."],
  ["镜头", "Shot"], ["本镜台词", "Shot dialogue"], ["画面描述", "Visual description"], ["风格连续性锁定", "Style continuity lock"], ["例如：暖金色高端产品广告，柔光，统一颗粒与色调", "For example: premium warm-gold product ad, soft light, consistent grain and color"], ["可选：本镜头需要的辅助画面", "Optional supporting visuals for this shot"], ["时长（秒）", "Duration (seconds)"], ["局部重做此镜头", "Redo this shot"], ["保留其他镜头，只清除此镜头的生成结果", "Keep other shots and clear only this shot's generated result"],
  ["秒", "sec"], ["正在保存", "Saving"], ["已保存", "Saved"], ["失败", "failed"], ["成功", "succeeded"], ["正在上传", "Uploading"], ["上传失败", "Upload failed"], ["已选择", "Selected"], ["选择", "Select"], ["下载", "Download"], ["绑定失败", "Binding failed"], ["请求失败", "Request failed"], ["服务器返回了无法识别的响应", "The server returned an unrecognized response"], ["已收到，谢谢你的反馈。", "Thanks, we received your feedback."],
  ["登录", "Sign in"], ["创建账号", "Create account"], ["邮箱", "Email"], ["密码", "Password"], ["登录或创建账号以继续。", "Sign in or create an account to continue."], ["加载中…", "Loading…"], ["API 访问", "API access"], ["退出登录", "Sign out"], ["安全工作区", "Secure workspace"], ["加载最新版本", "Load latest version"],
  ["节点工具箱", "Node toolbox"], ["连接所选节点", "Connect selected nodes"], ["组合所选节点", "Group selected nodes"], ["拖动画布平移", "Drag space to pan"], ["滚轮缩放", "Wheel to zoom"], ["无限画布", "Infinite canvas"], ["节点检查器", "Node inspector"], ["创建故事与镜头", "Create story + shot"], ["开始分镜批次", "Start storyboard batch"], ["推进", "Advance"], ["重试失败镜头", "Retry failed shot"], ["导出时间线清单", "Export timeline manifest"], ["本地预览导出", "Local preview export"], ["格式", "Format"], ["质量", "Quality"], ["我已检查时间线", "I reviewed the timeline"], ["渲染本地 MP4 预览", "Render local MP4 preview"], ["空白：创建故事、生成媒体，然后导出。", "Empty: create a story, generate media, then export."], ["选择节点以编辑详情。", "Select a node to edit its details."], ["标题", "Title"], ["内容", "Content"], ["本地生成", "Generate locally"], ["就绪", "Ready"], ["搜索", "Search"], ["关闭", "Close"], ["添加 5 秒镜头", "Add 5-second shot"], ["绑定到所有镜头", "Bind to all shots"]
];

const byChinese = new Map(pairs.map(([zh, en]) => [zh, en]));
const byEnglish = new Map(pairs.map(([zh, en]) => [en, zh]));
const originals = new WeakMap();
let locale = SUPPORTED.has(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : "en";

function translate(value, target = locale) {
  if (!value?.trim()) return value;
  const map = target === "en" ? byChinese : byEnglish;
  if (map.has(value)) return map.get(value);
  let output = value;
  const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [source, translated] of entries) if (output.includes(source)) output = output.split(source).join(translated);
  return output;
}

function applyNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    node.nodeValue = translate(originals.get(node));
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attr of ["placeholder", "aria-label", "title"]) {
    if (!node.hasAttribute(attr)) continue;
    const key = `${attr}:${node.getAttribute(attr)}`;
    if (!originals.has(node)) originals.set(node, new Map());
    const values = originals.get(node);
    if (values instanceof Map && !values.has(attr)) values.set(attr, node.getAttribute(attr));
    if (values instanceof Map) node.setAttribute(attr, translate(values.get(attr)));
  }
  node.childNodes.forEach(applyNode);
}

function applyDocument() {
  document.documentElement.lang = locale;
  document.title = locale === "en" ? "OpenReel Workspace" : "OpenReel 创作空间";
  document.querySelectorAll("[data-language-selector]").forEach(select => { select.value = locale; });
  applyNode(document.body);
}

export function setLocale(next) {
  if (!SUPPORTED.has(next)) return;
  locale = next;
  localStorage.setItem(STORAGE_KEY, locale);
  applyDocument();
  window.dispatchEvent(new CustomEvent("openreel:localechange", { detail: { locale } }));
}

export function localeCode() { return locale === "zh-CN" ? "zh-CN" : "en-US"; }
export function currentLocale() { return locale; }

export function initializeI18n() {
  document.querySelectorAll("[data-language-selector]").forEach(select => select.addEventListener("change", event => setLocale(event.currentTarget.value)));
  applyDocument();
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) applyNode(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export const builtinCategories = [
  {
    id: "ai",
    name: "人工智能",
    en: "ARTIFICIAL INTELLIGENCE",
    description: "从机器学习到通用智能，探索思想的边界。",
    icon: "BrainCircuit",
  },
  {
    id: "space",
    name: "太空探索",
    en: "SPACE EXPLORATION",
    description: "越过地平线，寻找人类的下一站。",
    icon: "Orbit",
  },
  {
    id: "life",
    name: "生命科学",
    en: "LIFE SCIENCES",
    description: "理解生命，重新想象生命的可能。",
    icon: "Dna",
  },
  {
    id: "energy",
    name: "未来能源",
    en: "FUTURE ENERGY",
    description: "让文明的下一次跃迁，拥有能量。",
    icon: "Zap",
  },
  {
    id: "human",
    name: "人类未来",
    en: "HUMANITY & FUTURE",
    description: "技术之外，我们想要怎样的未来？",
    icon: "Fingerprint",
  },
  {
    id: "maker",
    name: "创造者计划",
    en: "BUILD IN PUBLIC",
    description: "公开构建，把一个想法变成现实。",
    icon: "Box",
  },
];
const topics = [
  [
    "ai",
    "当 AI 开始理解世界，而不只是预测下一个词",
    "从语言模型走向世界模型，我们距离真正的机器理解还有多远？想和大家一起讨论空间智能与具身学习的下一步。",
    ["世界模型", "具身智能"],
    "discussion",
  ],
  [
    "space",
    "如果人类成为多行星物种，我们该带走什么？",
    "除了生存所必需的技术，语言、文化与共同记忆，是否也应成为星际航行的基础设施？",
    ["星际文明", "太空探索"],
    "discussion",
  ],
  [
    "maker",
    "开源项目：给每个人一个属于自己的 AI 研究助手",
    "从论文检索、阅读笔记到知识关联，我正在构建一个本地优先的研究工作台，欢迎一起参与。",
    ["开源", "AI Agent", "共同创造"],
    "project",
  ],
  [
    "human",
    "在一个无需工作的世界里，我们如何定义「有意义」？",
    "当生产效率不再是评价人的尺度，教育、创造和人与人的连接，会不会成为新的重心？",
    ["未来社会", "思考实验"],
    "discussion",
  ],
  [
    "life",
    "脑机接口的下一步：增强能力，还是重新认识自我？",
    "比带宽更值得讨论的，也许是神经数据的归属，以及我们如何为不可逆的技术建立共识。",
    ["脑机接口", "神经科学"],
    "discussion",
  ],
  [
    "energy",
    "聚变能源的最后一公里，究竟卡在哪里？",
    "我们讨论得最多的是点火，但材料、氚循环和可维护性，同样决定着聚变能否走进日常生活。",
    ["可控核聚变", "清洁能源"],
    "discussion",
  ],
  [
    "ai",
    "小模型、本地运行：个人 AI 的另一种未来",
    "不把所有数据交给云端，让模型围绕个人知识工作。关于本地部署与隐私保护，你有哪些实践？",
    ["端侧 AI", "隐私"],
    "discussion",
  ],
  [
    "maker",
    "一起做一个开放的低成本空气质量传感器",
    "用可复现的硬件、开放的数据和易读的可视化，让身边的环境变化变得可感知。第一版设计已开始。",
    ["开源硬件", "环境感知"],
    "project",
  ],
  [
    "space",
    "月球上的第一座图书馆，应该怎样设计？",
    "让知识在没有维护的环境下跨越千年：介质、语言、解码方式，哪一项最难？",
    ["月球基地", "长期主义"],
    "discussion",
  ],
  [
    "human",
    "技术乐观主义，需要怎样的现实主义？",
    "既保持对可能性的好奇，也认真讨论谁承担成本、谁参与决策，以及怎样验证真正的进步。",
    ["技术哲学", "公共讨论"],
    "discussion",
  ],
  [
    "life",
    "开放科学能否加速我们理解衰老？",
    "如果实验协议、失败结果和分析代码都能被复用，我们是否能少走一些弯路？",
    ["开放科学", "衰老研究"],
    "discussion",
  ],
  [
    "energy",
    "城市可以成为一块分布式电池吗？",
    "把建筑、车辆和储能连接起来，需要的不只是技术，还有能够协调不同参与者的机制。",
    ["储能", "智慧城市"],
    "discussion",
  ],
];
export function seed(db) {
  if (
    db.prepare("SELECT COUNT(*) AS n FROM posts").get().n ||
    db.prepare("SELECT value FROM settings WHERE key='seeded'").get()
  )
    return;
  const people = [
    ["demo-lin", "林间", "LIN", "关注智能与创造力的交汇处。"],
    ["demo-orbit", "Orbit", "OR", "向宇宙提问。"],
    ["demo-chen", "陈序", "CX", "把想法做出来。"],
    ["demo-mono", "Mono", "MO", "技术、哲学与日常。"],
    ["demo-echo", "Echo", "EC", "理解生命的复杂性。"],
    ["demo-ion", "Ion", "IO", "能源与未来基础设施。"],
  ];
  db.exec("BEGIN");
  try {
    const user = db.prepare(
      "INSERT OR IGNORE INTO users (id, email, name, initials, bio, password, demo, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    );
    people.forEach(([id, name, initials, bio]) =>
      user.run(
        id,
        id + "@example.invalid",
        name,
        initials,
        bio,
        "disabled",
        Date.now(),
      ),
    );
    const insert = db.prepare(
      "INSERT INTO posts (id, author_id, category, title, excerpt, content, tags, kind, demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
    );
    topics.forEach(([category, title, excerpt, tags, kind], i) => {
      const content = `${excerpt}\n\n## 一个值得追问的问题\n\n很多关于未来的讨论，从「技术能够做到什么」开始。我更想追问：当它真的走出实验室，我们希望它解决什么问题，又愿意为它付出什么？\n\n这篇帖子是 Naimakes 的**示例讨论**，用于展示社区的阅读与互动体验。下面是几个可供继续展开的方向。\n\n### 我想听听你的看法\n\n- 什么样的证据，会让你改变目前的判断？\n- 这个领域有哪些容易被忽略的限制条件？\n- 如果从一个小项目开始，你会选择验证什么？\n\n> 好的讨论，不必立即得到同一个答案，但可以让彼此提出更好的问题。\n\n欢迎分享你的经验、研究线索，或一个尚未成形的想法。`;
      insert.run(
        "topic-" + (i + 1),
        people[i % people.length][0],
        category,
        title,
        excerpt,
        content,
        JSON.stringify(tags),
        kind,
        Date.now() - (i + 1) * 3600000,
      );
    });
    const comment = db.prepare(
      "INSERT INTO comments (id, post_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    [
      "也许可以先区分「形成一个可操作的世界表征」和「真正理解」。我们要用什么实验来区分这两者？",
      "我比较关心模型能否把一种环境里学到的因果关系，迁移到另一个环境。欢迎分享相关的实验思路。",
    ].forEach((content, i) =>
      comment.run(
        "demo-comment-" + i,
        "topic-1",
        people[i + 2][0],
        content,
        Date.now() - (i + 1) * 1200000,
      ),
    );
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('seeded','1')").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

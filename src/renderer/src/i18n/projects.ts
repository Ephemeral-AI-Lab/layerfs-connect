// Chinese for the Projects screens: English source text -> zh-CN.
export const projectsZh: Record<string, string> = {
  // project history
  'Search branches or commits': '搜索分支或提交',
  'Open branches': '未结束',
  'Finished branches': '已结束',
  'Timeline': '时间线',
  '{count} entries': '{count} 条记录',
  'Locate selected branch': '定位当前分支',
  'Return to latest': '返回最新',
  'No file changes': '没有文件变更',
  'Select a commit to view details': '选择提交查看详情',
  'is not available in this history.': '暂未找到该历史记录。',
  // sidebar and Projects page
  '{name} in Store {store}': '{name}，位于存储 {store}',
  '”. Search by name, Store or source folder.': '”的项目。可按名称、存储或源文件夹搜索。',
  // a project's Store (cards, project page, delete dialog)
  'on {connection}': '位于 {connection}',
  'Local only': '仅本地',
  'local only': '仅本地',
  'on disk': '磁盘占用',
  'Store {value1}': '存储 {value1}',
  '{family} Store': '{family} 存储',
  'Connection': '连接',
  'its database': '其数据库',
  'Every Commit, Branch and Layer of {project} lives in a schema of {connection}; each Commit goes straight there.':
    '{project} 的每个 Commit、Branch 和 Layer 都保存在 {connection} 的一个 schema 中；每次 Commit 直接写入那里。',
  'Every Commit, Branch and Layer of {project} lives in this Store’s one SQLite file, in its Docker volume.':
    '{project} 的每个 Commit、Branch 和 Layer 都保存在此存储的 SQLite 文件中，位于其 Docker 卷内。',
  'Shared with 1 other project: a push or pull moves it too.': '与另外 1 个项目共享：推送或拉取会一并移动它。',
  'Shared with {count} other projects: a push or pull moves them too.': '与另外 {count} 个项目共享：推送或拉取会一并移动它们。',
  'Shared with other projects: a push or pull moves them too.': '与其他项目共享：推送或拉取会一并移动它们。',
  // delete project
  'This permanently deletes the project and its history from the Store {store}. This cannot be undone.':
    '这会从存储 {store} 中永久删除该项目及其历史记录，且无法撤销。',
  'The Store and its 1 other project stay.': '该存储及其中另外 1 个项目会保留。',
  'The Store and its {count} other projects stay.': '该存储及其中另外 {count} 个项目会保留。',
  'The linked copy on {remote} keeps the project until the Store’s next push.': '{remote} 上的关联副本会保留该项目，直到此存储下次推送。',
  // new project: its Store
  'Reading Stores…': '正在读取存储…',
  'Choose a Store': '选择存储',
  'New SQLite Store': '新建 SQLite 存储',
  'New SQLite Store…': '新建 SQLite 存储…',
  'New Store name': '新存储名称',
  'my-store': 'my-store',
  'size unknown': '大小未知',
  'New Store {store}': '新存储 {store}',
  'Store {store}': '存储 {store}',
  'Name the new Store.': '请为新存储命名。',
  'Store names use 1–32 lowercase letters, numbers and hyphens, starting with a letter or number.':
    '存储名称使用 1–32 个小写字母、数字和连字符，并以字母或数字开头。',
  'A Store has this name; choose it in the list instead.': '已有同名存储；请改为在列表中选择它。',
  'A new SQLite Store in its own Docker volume; more projects can join it later.': '一个位于独立 Docker 卷中的新 SQLite 存储；之后可加入更多项目。',
  'It shares {store}’s file and its link: pushes to {remote} / {file} carry every project in it.':
    '它与 {store} 共用文件和关联：推送到 {remote} / {file} 时会带上其中的所有项目。',
  'It shares {store}’s file: a push or pull moves every project in it.': '它与 {store} 共用文件：推送或拉取会移动其中的所有项目。',
}

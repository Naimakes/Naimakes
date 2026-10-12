// 内置站主：永久写在代码里，只保存加盐的 scrypt 哈希，不保存明文密码。
// 它始终生效；若另外通过 OWNER_BOOTSTRAP_FILE 或 secrets/owner.json 添加了站主，两个账号同时生效。
export const BUILT_IN_OWNER = {
  id: "Naimakes",
  email: "naimakes@icloud.com",
  passwordHash:
    "fe6c03f7fea78c1aa3aa97ac435299a7:bc304dbfff7a37d419737ddb277fd2d0691c2a68d0813df28f61f6c8e3a4a5eb30c1262c22bb93055a70455bfca4909f82fe637811832af85ef112af0d90df33",
};

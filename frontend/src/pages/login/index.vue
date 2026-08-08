<template>
  <div class="loginPage" :style="{ height: isElectron ? 'calc(100vh - 32px)' : '100vh' }">
    <div class="formBox">
      <!-- 设置弹窗 -->
      <t-dialog v-model:visible="showSettingModal" :header="$t('login.settings')" @confirm="handleSaveSetting" :width="400">
        <t-form label-width="80px" labelAlign="top">
          <t-form-item :label="$t('login.requestAddress')">
            <t-input v-model="tempBaseUrl" placeholder="http://localhost:10588" />
          </t-form-item>
        </t-form>
      </t-dialog>
      <div class="logoBox fc">
        <div class="logoImg"></div>
        <div class="fc c">
          <span class="logoText">ToonFlow</span>
          <span class="slogan">{{ $t("login.slogan") }}</span>
        </div>
      </div>
      <div class="login-form">
        <t-input v-model="state.user.username" :placeholder="$t('login.username')" autocomplete="username" size="large"></t-input>
        <t-input v-model="state.user.password" type="password" :placeholder="$t('login.password')" size="large"></t-input>
        <t-button class="loginBtn" theme="primary" size="large" :loading="state.loginLoading" @click="handleLogin" block>
          {{ $t("login.login") }}
        </t-button>
      </div>
      <div class="tips c">{{ $t("login.tips") }}</div>
    </div>
  </div>
  <div class="settingBtn">
    <t-dropdown :options="langOptions" trigger="click" @click="handleChangeLang" :maxColumnWidth="150">
      <t-button shape="circle" theme="default" size="large">
        <template #icon>
          <i-translate theme="outline" size="20" />
        </template>
      </t-button>
    </t-dropdown>
    <t-button shape="circle" theme="primary" size="large" @click="showSettingModal = true">
      <template #icon>
        <i-setting-two theme="outline" size="20" />
      </template>
    </t-button>
  </div>
  <t-dialog
    v-model:visible="mustChangePasswordVisible"
    header="首次登录必须修改默认密码"
    :close-btn="false"
    :close-on-overlay-click="false"
    :on-confirm="changeDefaultPassword">
    <t-alert theme="warning" message="默认账号密码是公开信息。请设置至少 8 位的新密码后继续。" />
    <t-form label-align="top" class="passwordChangeForm">
      <t-form-item label="新密码"><t-input v-model="passwordChange.password" type="password" autocomplete="new-password" /></t-form-item>
      <t-form-item label="确认新密码"><t-input v-model="passwordChange.confirm" type="password" autocomplete="new-password" /></t-form-item>
    </t-form>
  </t-dialog>
</template>

<script setup>
import { useI18n } from "vue-i18n";
import Router from "@/router/index.ts";
import logo from "@/assets/logo.png";
import axios from "@/utils/axios";
import settingStore from "@/stores/setting";
import { storeToRefs } from "pinia";
import { languageList, cachedLocale } from "@/locales";

const { locale } = useI18n();
const langOptions = languageList.map((item) => ({
  content: item.label,
  value: item.value,
}));
const handleChangeLang = (data) => {
  locale.value = data.value;
  cachedLocale.value = data.value;
};

const store = settingStore();
const { baseUrl, isElectron } = storeToRefs(store);

const showSettingModal = ref(false);
const tempBaseUrl = ref(baseUrl.value);

// 保存设置
const handleSaveSetting = () => {
  baseUrl.value = tempBaseUrl.value;
  showSettingModal.value = false;
  window.$message.success($t("login.settingsSaved"));
};
const state = ref({
  show: true,
  loginLoading: false,
  user: {
    username: "",
    password: "",
  },
  rules: {
    username: [{ required: true, message: $t("login.usernameRequired") }],
    password: [{ required: true, message: $t("login.passwordRequired") }],
  },
});
const mustChangePasswordVisible = ref(false);
const loggedInUser = ref({ id: 0, name: "" });
const passwordChange = ref({ password: "", confirm: "" });

const completeLogin = () => {
  Router.push("/project");
  window.$message.success($t("login.loginSuccess"));
  state.value.loginLoading = false;
};

const handleLogin = () => {
  if (!state.value.user.username || !state.value.user.password) {
    window.$message.warning($t("login.enterUsernameAndPassword"));
    return;
  }
  state.value.loginLoading = true;
  const obj = { ...state.value.user };
  axios
    .post("/login/login", obj)
    .then(({ data }) => {
      localStorage.setItem("token", data.token);
      localStorage.setItem("userId", data.id);
      loggedInUser.value = { id: data.id, name: data.name };
      if (data.mustChangePassword) {
        mustChangePasswordVisible.value = true;
        state.value.loginLoading = false;
      } else {
        completeLogin();
      }
    })
    .catch((e) => {
      state.value.loginLoading = false;
      window.$message.error(e.message);
    });
};

const changeDefaultPassword = async () => {
  if (passwordChange.value.password.length < 8) {
    window.$message.warning("新密码至少 8 位");
    return false;
  }
  if (passwordChange.value.password !== passwordChange.value.confirm) {
    window.$message.warning("两次输入的密码不一致");
    return false;
  }
  try {
    await axios.post("/setting/loginConfig/updateUserPwd", {
      id: loggedInUser.value.id,
      name: loggedInUser.value.name,
      password: passwordChange.value.password,
    });
    mustChangePasswordVisible.value = false;
    completeLogin();
    return true;
  } catch (error) {
    window.$message.error(error?.message || "修改密码失败");
    return false;
  }
};
</script>

<style lang="scss" scoped>
.loginPage {
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;

  .formBox {
    width: 380px;
    padding: 40px 40px 30px;
    background: var(--td-bg-color-container);
    border-radius: 20px;
    box-shadow: var(--td-shadow-3);

    .logoBox {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 30px;
      gap: 12px;

      .logoImg {
        width: 64px;
        height: 64px;
        background-color: var(--td-text-color-primary);
        mask: url("@/assets/logo.svg") no-repeat center;
        mask-size: contain;
        -webkit-mask: url("@/assets/logo.svg") no-repeat center;
        -webkit-mask-size: contain;
      }

      .logoText {
        font-size: 36px;
        font-weight: 800;
        color: var(--td-text-color-primary);
        letter-spacing: 1px;
      }
      .slogan {
        opacity: 0.5;
        white-space: nowrap;
      }
    }

    .login-form {
      display: flex;
      flex-direction: column;
      gap: 20px;

      .input-icon {
        color: var(--td-text-color-placeholder);
        font-size: 18px;
      }

      :deep(.t-input) {
        border-radius: 8px;
      }
    }
  }
  .tips {
    opacity: 0.5;
    font-size: 12px;
    margin-top: 18px;
  }
}

.default-hint {
  margin-top: 20px;
  border-radius: 8px;

  :deep(.t-alert__message) {
    width: 100%;
  }

  .hint-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: #666;

    p {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  code {
    background: var(--td-bg-color-container);
    padding: 2px 10px;
    border-radius: 4px;
    font-family: "Monaco", "Menlo", monospace;
    font-weight: 500;
    font-size: 13px;
    border: 1px solid var(--td-component-border);
  }
}
.passwordChangeForm { margin-top: 14px; }

.settingBtn {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>

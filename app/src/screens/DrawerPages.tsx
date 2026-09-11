import { DrawerPage } from '../components/Drawer'
import { IconChevronRight } from '../components/icons'
import { goBack, navigate } from '../router'
import './drawerpages.css'

function Rows({ items }: { items: Array<{ label: string; value?: string; to?: string }> }) {
  return (
    <div className="dprows">
      {items.map((it) => (
        <button
          key={it.label}
          className="dprow"
          onClick={() => it.to && navigate(it.to)}
        >
          <span className="dprow__label">{it.label}</span>
          <span className="dprow__value">{it.value ?? ''}</span>
          <IconChevronRight size={15} />
        </button>
      ))}
    </div>
  )
}

export function AccountScreen() {
  return (
    <DrawerPage title="账号与安全" onBack={() => goBack('me')}>
      <Rows
        items={[
          { label: '手机号', value: '132****2969' },
          { label: '微信', value: '已绑定' },
          { label: 'QQ', value: '未绑定' },
          { label: '修改密码', to: 'privacy' },
          { label: '注销账号' },
        ]}
      />
    </DrawerPage>
  )
}

export function VerifyScreen() {
  return (
    <DrawerPage title="校园认证" onBack={() => goBack('me')}>
      <div className="dpcard">
        <div className="dpcard__title">未认证</div>
        <p className="dpcard__desc">
          完成学生认证后可解锁校园广场发帖、同校推荐等能力。
        </p>
        <button className="dpcard__btn" onClick={() => navigate('board')}>
          去认证
        </button>
      </div>
      <Rows
        items={[
          { label: '认证方式', value: '学生证 / 校园卡' },
          { label: '认证状态', value: '待认证' },
        ]}
      />
    </DrawerPage>
  )
}

export function PrivacyScreen() {
  return (
    <DrawerPage title="隐私设置" onBack={() => goBack('me')}>
      <Rows
        items={[
          { label: '谁可以看到我的动态', value: '同校同学' },
          { label: '允许通过手机号找到我', value: '已关闭' },
          { label: '个性化推荐', value: '已开启' },
          { label: '地理位置', value: '使用时允许' },
        ]}
      />
    </DrawerPage>
  )
}

export function BlacklistScreen() {
  return (
    <DrawerPage title="黑名单" onBack={() => goBack('me')}>
      <div className="dpempty">黑名单为空</div>
    </DrawerPage>
  )
}

export function AboutScreen() {
  return (
    <DrawerPage title="版本信息" onBack={() => goBack('me')}>
      <div className="dpcard dpcard--center">
        <div className="dpcard__brand">Campus</div>
        <div className="dpcard__version">v2.10.0</div>
        <p className="dpcard__desc">本 demo 为本地复刻版本，数据全部为 mock，无任何网络请求。</p>
        <button className="dpcard__btn" onClick={() => navigate('upgrade')}>
          检查更新
        </button>
      </div>
    </DrawerPage>
  )
}

export function ContactScreen() {
  return (
    <DrawerPage title="联系我们" onBack={() => goBack('me')}>
      <Rows
        items={[
          { label: '客服邮箱', value: 'support@campus.demo' },
          { label: '意见反馈', to: 'board' },
          { label: '用户协议' },
          { label: '隐私政策' },
        ]}
      />
    </DrawerPage>
  )
}

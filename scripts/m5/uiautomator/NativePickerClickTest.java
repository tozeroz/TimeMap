package com.campusx.m5;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.os.Bundle;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * 在**真实的 Android 系统文件选择器**（com.android.documentsui）里找到一张图片并点击。
 *
 * 为什么用无障碍 ACTION_CLICK，而不是 `adb shell input tap` / UiObject.click()：
 *   本机 MuMu 模拟器的 InputDispatcher 处于 `DispatchFrozen: true`（dumpsys input 实测，
 *   该冻结早于本次验证数小时）。所有经 InputManager 注入的事件（input / monkey /
 *   UiObject.click）与写入内核 input 设备的事件（sendevent）都被挂起在队列里，
 *   坐标点击一律不生效，而且注入命令本身会一直阻塞。
 *   无障碍 ACTION_CLICK 是由**目标应用自己**执行点击（View.performClick 那一路），
 *   不经过 InputDispatcher，因此在这个环境下是唯一可行的真实交互路径。
 *
 *   这不是"绕过产品代码"：被点的仍是 DocumentsUI 自己的列表项；
 *   选择结果同样经 onActivityResult → Capacitor → Chromium 交回 WebView 的 <input type=file>。
 *
 * 参数通过设备上的文件传入（比 -e Bundle 可靠）：
 *   /data/local/tmp/m5picker-args.txt   形如 `needle=p1.png`
 *
 * 用法（由 scripts/m5/device-native-picker-check.mjs 调用）：
 *   adb shell uiautomator runtest native-picker-click.jar -c com.campusx.m5.NativePickerClickTest
 */
public class NativePickerClickTest extends android.test.InstrumentationTestCase {

    private static final String TAG = "M5PICKER";
    private static final String ARGS_FILE = "/data/local/tmp/m5picker-args.txt";

    private static void log(String s) {
        Log.i(TAG, s);
        System.out.println("M5PICKER| " + s);
    }

    private static String arg(String key, String def) {
        try {
            File f = new File(ARGS_FILE);
            if (f.exists()) {
                BufferedReader r = new BufferedReader(new FileReader(f));
                String line;
                while ((line = r.readLine()) != null) {
                    int i = line.indexOf('=');
                    if (i > 0 && line.substring(0, i).trim().equals(key)) {
                        r.close();
                        return line.substring(i + 1).trim();
                    }
                }
                r.close();
            }
        } catch (Throwable t) {
            log("read args file failed: " + t);
        }
        try {
            Bundle b = getInstrumentation().getArguments();
            if (b != null && b.getString(key) != null) return b.getString(key);
        } catch (Throwable ignored) {
        }
        return def;
    }

    private static String cd(AccessibilityNodeInfo n) {
        CharSequence d = n.getContentDescription();
        if (d != null && d.length() > 0) return d.toString();
        CharSequence t = n.getText();
        return t == null ? "" : t.toString();
    }

    private static String describe(AccessibilityNodeInfo n) {
        android.graphics.Rect r = new android.graphics.Rect();
        n.getBoundsInScreen(r);
        return "class=" + n.getClassName()
                + " pkg=" + n.getPackageName()
                + " res=" + n.getViewIdResourceName()
                + " desc='" + cd(n) + "'"
                + " bounds=[" + r.left + "," + r.top + "][" + r.right + "," + r.bottom + "]"
                + " clickable=" + n.isClickable()
                + " enabled=" + n.isEnabled();
    }

    /** 依次尝试三条路径拿到 UiAutomation（老 uiautomator 版本的桩类不保证有 getInstrumentation）。 */
    private UiAutomation obtainUiAutomation() {
        try {
            Instrumentation ins = getInstrumentation();
            if (ins != null) {
                UiAutomation ua = ins.getUiAutomation();
                if (ua != null) {
                    log("UIAUTOMATION_VIA=instrumentation");
                    return ua;
                }
            }
        } catch (Throwable t) {
            log("instrumentation.getUiAutomation() 不可用: " + t);
        }
        // 反射 UiDevice 内部持有的 UiAutomation
        try {
            Object dev = com.android.uiautomator.core.UiDevice.getInstance();
            for (String fn : new String[] { "mUiAutomation", "mAutomation" }) {
                try {
                    java.lang.reflect.Field f = dev.getClass().getDeclaredField(fn);
                    f.setAccessible(true);
                    Object o = f.get(dev);
                    if (o instanceof UiAutomation) {
                        log("UIAUTOMATION_VIA=UiDevice." + fn);
                        return (UiAutomation) o;
                    }
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable t) {
            log("UiDevice 反射不可用: " + t);
        }
        // 自己连一个（隐藏 API，运行时才解析）
        try {
            Class<?> connCls = Class.forName("android.app.UiAutomationConnection");
            Object conn = connCls.getConstructor().newInstance();
            Class<?> uaCls = Class.forName("android.app.UiAutomation");
            Object ua = uaCls.getConstructor(Looper.class, connCls).newInstance(Looper.getMainLooper(), conn);
            uaCls.getMethod("connect").invoke(ua);
            log("UIAUTOMATION_VIA=standalone_connect");
            return (UiAutomation) ua;
        } catch (Throwable t) {
            log("自建 UiAutomation 不可用: " + t);
        }
        return null;
    }

    public void testClickImageInNativePicker() throws Exception {
        String needle = arg("needle", ".png");
        log("PARAM needle='" + needle + "'");

        UiAutomation ua = obtainUiAutomation();
        if (ua == null) {
            log("RESULT=FAIL reason=no_uiautomation");
            fail("cannot obtain UiAutomation");
            return;
        }

        AccessibilityNodeInfo root = null;
        for (int i = 0; i < 10 && root == null; i++) {
            root = ua.getRootInActiveWindow();
            if (root == null) Thread.sleep(500);
        }
        if (root == null) {
            log("RESULT=FAIL reason=root_in_active_window_is_null");
            fail("root is null");
            return;
        }
        log("ACTIVE_PACKAGE=" + root.getPackageName());
        log("ACTIVE_ACTIVITY=" + (ua.getRootInActiveWindow() == null ? "?" : String.valueOf(root.getPackageName())));

        // ---- BFS：找 content-desc / text 含 needle 的节点 ----
        AccessibilityNodeInfo hit = null;
        int visited = 0;
        Deque<AccessibilityNodeInfo> q = new ArrayDeque<AccessibilityNodeInfo>();
        q.add(root);
        while (!q.isEmpty()) {
            AccessibilityNodeInfo n = q.poll();
            visited++;
            if (n == null) continue;
            if (cd(n).contains(needle)) {
                hit = n;
                break;
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                AccessibilityNodeInfo c = n.getChild(i);
                if (c != null) q.add(c);
            }
        }
        log("VISITED_NODES=" + visited);
        if (hit == null) {
            log("RESULT=FAIL reason=no_node_matching_needle");
            fail("no node matching " + needle);
            return;
        }
        log("MATCHED_NODE " + describe(hit));

        // ---- 向上找最近的 clickable 祖先 ----
        AccessibilityNodeInfo target = hit;
        int up = 0;
        while (target != null && !target.isClickable() && up < 8) {
            AccessibilityNodeInfo p = target.getParent();
            if (p == null) break;
            target = p;
            up++;
            log("ANCESTOR[" + up + "] " + describe(target));
        }
        if (target == null || !target.isClickable()) {
            log("no clickable ancestor; falling back to matched node itself");
            target = hit;
        }
        log("CLICK_TARGET " + describe(target));

        boolean clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        log("ACTION_CLICK_RESULT=" + clicked);
        if (!clicked) {
            boolean sel = target.performAction(AccessibilityNodeInfo.ACTION_SELECT);
            log("ACTION_SELECT_RESULT=" + sel);
            clicked = sel;
        }

        Thread.sleep(2500);
        try {
            AccessibilityNodeInfo after = ua.getRootInActiveWindow();
            log("ACTIVE_PACKAGE_AFTER=" + (after == null ? "(null)" : String.valueOf(after.getPackageName())));
        } catch (Throwable t) {
            log("ACTIVE_PACKAGE_AFTER=ERR " + t);
        }
        log("RESULT=" + (clicked ? "CLICKED" : "NOT_CLICKED"));
    }
}

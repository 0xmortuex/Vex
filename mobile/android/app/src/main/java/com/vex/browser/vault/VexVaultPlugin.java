package com.vex.browser.vault;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secrets at rest, the way the desktop build stores them.
 *
 * On Windows the AI token goes through Electron's safeStorage, which is DPAPI.
 * The Android equivalent is a key that never leaves the Keystore: this
 * generates an AES key there, encrypts with AES/GCM, and keeps only the IV and
 * the ciphertext in SharedPreferences. A rooted device or a full backup gets
 * the ciphertext and not the key.
 *
 * The AI worker token is the only thing that uses it today. Password-vault
 * parity would build on the same primitive — see PORTING.md.
 */
@CapacitorPlugin(name = "VexVault")
public class VexVaultPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "vex-vault-key";
    private static final String PREFS = "vex-vault";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("key", "");
        String value = call.getString("value", "");
        if (name == null || name.isEmpty()) {
            call.reject("A key is required");
            return;
        }
        try {
            if (value == null || value.isEmpty()) {
                prefs().edit().remove(name).apply();
                call.resolve();
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] blob = new byte[iv.length + sealed.length];
            System.arraycopy(iv, 0, blob, 0, iv.length);
            System.arraycopy(sealed, 0, blob, iv.length, sealed.length);
            prefs().edit().putString(name, Base64.encodeToString(blob, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception ex) {
            call.reject("Could not store the secret: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String name = call.getString("key", "");
        JSObject result = new JSObject();
        String stored = name == null ? null : prefs().getString(name, null);
        if (stored == null) {
            result.put("value", "");
            call.resolve(result);
            return;
        }
        try {
            byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
            if (blob.length <= IV_LENGTH) throw new IllegalStateException("Stored value is truncated");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, blob, 0, IV_LENGTH));
            byte[] plain = cipher.doFinal(blob, IV_LENGTH, blob.length - IV_LENGTH);
            result.put("value", new String(plain, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception ex) {
            // A key the user cleared, or a device that reset the Keystore: the
            // secret is gone rather than wrong, and the chrome asks again.
            prefs().edit().remove(name).apply();
            result.put("value", "");
            result.put("lost", true);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void has(PluginCall call) {
        String name = call.getString("key", "");
        JSObject result = new JSObject();
        result.put("value", name != null && prefs().contains(name));
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        prefs().edit().clear().apply();
        call.resolve();
    }
}

package androidx.appcompat.app;

import android.app.Activity;

import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContract;

public class AppCompatActivity extends Activity {
    public <I, O> ActivityResultLauncher<I> registerForActivityResult(
            ActivityResultContract<I, O> contract, ActivityResultCallback<O> callback) {
        return null;
    }
}

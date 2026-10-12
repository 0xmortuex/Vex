package androidx.appcompat.app;

import androidx.fragment.app.FragmentActivity;

import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContract;

public class AppCompatActivity extends FragmentActivity {
    public <I, O> ActivityResultLauncher<I> registerForActivityResult(
            ActivityResultContract<I, O> contract, ActivityResultCallback<O> callback) {
        return null;
    }
}

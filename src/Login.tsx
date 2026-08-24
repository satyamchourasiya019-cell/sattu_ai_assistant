import { supabase } from "./supabaseClient";

function Login() {
  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
    });
  };

  return (
    <div className="login-container">
      <h2>Sattu AI Assistant</h2>
      <p>Continue karne ke liye login karo</p>
      <button onClick={handleGoogleLogin}>
        Google se Login karo
      </button>
    </div>
  );
}

export default Login;
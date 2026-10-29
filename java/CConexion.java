import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

public class CConexion {

    private Connection conexion;

    private final String servidor = "localhost";
    private final String puerto = "53509";
    private final String baseDatos = "TallerMecanicoDB";
    private final String usuario = "usersql";
    private final String contraseña = "root123";

    public Connection establecerConexion() {

        String url = "jdbc:sqlserver://" + servidor + ":" + puerto
                + ";databaseName=" + baseDatos
                + ";encrypt=false"
                + ";trustServerCertificate=true"
                + ";loginTimeout=15";

        try {

            Class.forName("com.microsoft.sqlserver.jdbc.SQLServerDriver");

            conexion = DriverManager.getConnection(
                    url,
                    usuario,
                    contraseña
            );

            System.out.println("=================================");
            System.out.println("CONEXIÓN EXITOSA");
            System.out.println("Servidor: " + servidor + ":" + puerto);
            System.out.println("Base de datos: " + baseDatos);
            System.out.println("Usuario: " + usuario);
            System.out.println("=================================");

        } catch (ClassNotFoundException e) {

            System.out.println("ERROR: No se encontró el driver JDBC.");
            e.printStackTrace();

        } catch (SQLException e) {

            System.out.println("ERROR al conectar con SQL Server.");
            e.printStackTrace();
        }

        return conexion;
    }
}